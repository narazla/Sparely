import "server-only";
import { all, one } from "./db";
import { calibrateImpact, costCurve, frontierPoint, IMPACT_WEIGHT, recommend, type PlannedEvent } from "./engine";
import { DEFAULT_PARAMS } from "./params";
import { needsSignoff, SCE_FUNCLOC_SQL, SCE_MIN_SPARE } from "./rules";
import { CRITS, isCritical, type Action, type Crit, type Health, type MaterialRow, type Params, type Recommendation } from "./types";

let materials: MaterialRow[] | null = null;
let plannedByMat: Map<number, PlannedEvent[]> | null = null;
let metaCache: Record<string, string> | null = null;

export function getMeta(): Record<string, string> {
  if (!metaCache) {
    metaCache = Object.fromEntries(all<{ key: string; value: string }>("SELECT key, value FROM meta").map((r) => [r.key, r.value]));
  }
  return metaCache;
}

export const asOf = () => getMeta().as_of;

export function getMaterials(): MaterialRow[] {
  if (!materials)
    materials = all<MaterialRow>(
      `SELECT m.*, COALESCE(t.tam_qty, 0) tam_qty, COALESCE(s.n, 0) n_funcloc_sce
       FROM material m LEFT JOIN tam_scope t USING (material_no)
       LEFT JOIN (SELECT material_no, COUNT(DISTINCT funcloc) n FROM material_funcloc WHERE ${SCE_FUNCLOC_SQL} GROUP BY 1) s USING (material_no)`
    );
  return materials;
}

export function getPlanned(): Map<number, PlannedEvent[]> {
  if (!plannedByMat) {
    const base = Date.parse(asOf() + "T00:00:00Z");
    plannedByMat = new Map();
    for (const r of all<{ material_no: number; due_date: string; qty: number }>(
      "SELECT material_no, due_date, qty FROM planned_demand ORDER BY due_date"
    )) {
      const list = plannedByMat.get(r.material_no) ?? [];
      list.push({ offset: (Date.parse(r.due_date + "T00:00:00Z") - base) / 86_400_000, qty: r.qty });
      plannedByMat.set(r.material_no, list);
    }
  }
  return plannedByMat;
}

let impact: { scale: number; emergenciesPerYear: number; emergencies: number; days: number } | null = null;

/** Downtime probability calibrated to the emergency notifications actually observed. */
export function getImpact() {
  if (!impact) {
    const from = "2025-06-01"; // same window as the pipeline failure rates (May 2025 backlog excluded)
    const to = getMeta().history_end;
    const n = one<{ n: number }>(
      "SELECT COUNT(*) n FROM notification WHERE priority = 'Emergency' AND notification_date >= ? AND notification_date <= ?",
      from,
      to
    )!.n;
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
    const perYear = (n * 365) / days;
    impact = { scale: calibrateImpact(getMaterials(), getPlanned(), DEFAULT_PARAMS, perYear), emergenciesPerYear: perYear, emergencies: n, days };
  }
  return impact;
}

/** Safety-critical locations found by the SCE tag rule, and how many of them the FuncLoc list rates S (lowest). */
export function sceLocations() {
  return one<{ locations: number; rated_s: number; rated_ab: number }>(
    `SELECT COUNT(*) locations, SUM(criticality = 'S') rated_s, SUM(criticality IN ('A','B')) rated_ab FROM funcloc WHERE ${SCE_FUNCLOC_SQL}`
  )!;
}

export const downtimeProbabilities = () => {
  const s = getImpact().scale;
  return (Object.keys(IMPACT_WEIGHT) as Crit[]).map((k) => ({ crit: k, prob: Math.min(1, IMPACT_WEIGHT[k] * s) }));
};

let twinMap: Map<number, number[]> | null = null;

/** Material numbers that share an identical description and unit with another number. */
export function getTwins(): Map<number, number[]> {
  if (!twinMap) {
    twinMap = new Map();
    for (const r of all<{ material_no: number; twin_material_no: number }>("SELECT material_no, twin_material_no FROM material_twin")) {
      const l = twinMap.get(r.material_no) ?? [];
      l.push(r.twin_material_no);
      twinMap.set(r.material_no, l);
    }
  }
  return twinMap;
}

/**
 * Before buying, use spare stock held under an identical material number.
 * A twin gives away only what it holds above its own reorder point (all of it if
 * it should not be stocked); reorders are served in priority order.
 */
function applyIdenticalStock(recs: Recommendation[], day: string) {
  const twins = getTwins();
  const byId = new Map(recs.map((r) => [r.material_no, r]));
  const spare = new Map<number, number>();
  // a safety-critical twin never gives away its own minimum spare
  const available = (t: Recommendation) => Math.max(0, Math.floor(t.stock - (t.stocked ? Math.max(t.reorder_point, t.sce ? SCE_MIN_SPARE : 0) : 0)));
  for (const r of recs) {
    const t = twins.get(r.material_no);
    if (!t) continue;
    r.twin_count = t.length;
    r.flags.push(`Same description as ${t.length} other material number${t.length > 1 ? "s" : ""}`);
  }
  const reorders = recs.filter((r) => r.action === "Reorder" && twins.has(r.material_no)).sort((a, b) => b.priority - a.priority);
  for (const r of reorders) {
    let got = 0;
    const from: number[] = [];
    for (const id of twins.get(r.material_no)!) {
      const t = byId.get(id);
      if (!t || got >= r.order_qty) continue;
      if (!spare.has(id)) spare.set(id, available(t));
      const take = Math.min(spare.get(id)!, r.order_qty - got);
      if (take <= 0) continue;
      spare.set(id, spare.get(id)! - take);
      if (t.excess_qty > 0) {
        t.excess_qty = Math.max(0, t.excess_qty - take);
        t.excess_value = t.excess_qty * t.price;
      }
      got += take;
      from.push(id);
    }
    if (got <= 0) continue;
    r.transfer_qty = got;
    r.transfer_from = from;
    r.order_qty -= got;
    r.order_value = r.order_qty * r.price;
    r.reasons.push(
      `Identical part ${from.join(", ")} holds spare stock: transfer ${got} ${r.unit} instead of buying` +
        (r.order_qty > 0 ? `, then buy the remaining ${r.order_qty}.` : " — no purchase needed.")
    );
    if (r.order_qty <= 0) {
      r.action = "Transfer";
      r.order_by = day;
      // the need is still real, but it is no longer a purchase
      r.reasons = r.reasons.map((t) => t.replace(/is at or below the reorder point: order (.+) now\.$/, "is at or below the reorder point: $1 needed."));
    }
  }
}

// Recommendations depend only on params: cache a few parameter sets.
const recCache = new Map<string, Recommendation[]>();

export function getRecommendations(p: Params): Recommendation[] {
  const key = JSON.stringify(p);
  let recs = recCache.get(key);
  if (!recs) {
    const planned = getPlanned();
    const day = asOf();
    const scale = getImpact().scale;
    recs = getMaterials().map((m) => recommend(m, planned.get(m.material_no), p, day, scale));
    applyIdenticalStock(recs, day);
    for (const r of recs)
      r.requires_approval =
        (r.action === "Reorder" && needsSignoff("reorder", r.order_value, r.sce)) || (r.action === "Reduce" && needsSignoff("reduce", r.excess_value, r.sce));
    if (recCache.size > 16) recCache.delete(recCache.keys().next().value!);
    recCache.set(key, recs);
  }
  return recs;
}

export interface Portfolio {
  materials: number;
  currentStockValue: number;
  currentStockValuePo: number;
  targetInventoryValue: number;
  excessValue: number;
  excessValuePo: number;
  reorderValue: number;
  transfer: { parts: number; units: number; valueAvoided: number; partialReorders: number };
  workingCapitalRelease: number;
  current: { holding: number; risk: number; stockouts: number; downtimeEvents: number; total: number };
  recommended: { holding: number; risk: number; stockouts: number; downtimeEvents: number; total: number };
  actions: Record<Action, number>;
  urgentCritical: number;
  criticalAtRisk: number;
  health: { status: Health; count: number; value: number }[];
  byCriticality: { crit: Crit; materials: number; stockValue: number; reorder: number; atRisk: number }[];
  stockedChange: { toStock: number; toNonStock: number };
  /** safety-critical parts, the spares bought only for safety, long-lead parts and decisions that need sign-off */
  governance: { sce: number; sceReorders: number; sceReorderValue: number; sceFloorOnly: number; longLead: number; signoffBuys: number; signoffReductions: number };
}

const HEALTH_ORDER: Health[] = [
  "Stockout",
  "Below reorder point",
  "Healthy",
  "Excess",
  "Slow-moving",
  "Non-moving",
  "Potentially obsolete",
  "Critical insurance spare",
  "TAM reserve",
  "Insurance gap",
  "No stock needed",
];

export function portfolio(p: Params): Portfolio {
  const recs = getRecommendations(p);
  const mats = getMaterials();
  const actions: Record<Action, number> = { Reorder: 0, Transfer: 0, Reduce: 0, Monitor: 0, Maintain: 0 };
  const transfer = { parts: 0, units: 0, valueAvoided: 0, partialReorders: 0 };
  const health = new Map<Health, { count: number; value: number }>();
  const crit = new Map<Crit, { materials: number; stockValue: number; reorder: number; atRisk: number }>();
  let currentStockValue = 0,
    currentStockValuePo = 0,
    targetInventoryValue = 0,
    excessValue = 0,
    excessValuePo = 0,
    reorderValue = 0,
    urgentCritical = 0,
    criticalAtRisk = 0,
    toStock = 0,
    toNonStock = 0;
  const cur = { holding: 0, risk: 0, stockouts: 0, downtimeEvents: 0, total: 0 };
  const rec = { holding: 0, risk: 0, stockouts: 0, downtimeEvents: 0, total: 0 };
  const gov = { sce: 0, sceReorders: 0, sceReorderValue: 0, sceFloorOnly: 0, longLead: 0, signoffBuys: 0, signoffReductions: 0 };
  recs.forEach((r, i) => {
    if (r.sce) gov.sce++;
    if (r.sce && r.action === "Reorder") {
      gov.sceReorders++;
      gov.sceReorderValue += r.order_value;
    }
    // stocked only because of the minimum spare: the cost model alone would buy on demand
    if (r.safety_floor) gov.sceFloorOnly++;
    if (r.long_lead) gov.longLead++;
    if (r.requires_approval) {
      if (r.action === "Reduce") gov.signoffReductions++;
      else gov.signoffBuys++;
    }
    const value = r.stock * r.price;
    currentStockValue += value;
    if (mats[i].price_source === "PO history") {
      currentStockValuePo += value;
      excessValuePo += r.excess_value;
    }
    targetInventoryValue += r.cost.avgInventory * r.price;
    excessValue += r.excess_value;
    reorderValue += r.order_value;
    actions[r.action]++;
    if (r.transfer_qty > 0) {
      transfer.parts++;
      transfer.units += r.transfer_qty;
      transfer.valueAvoided += r.transfer_qty * r.price;
      if (r.action === "Reorder") transfer.partialReorders++;
    }
    // critical reorders only; transfers that replaced a critical reorder keep their urgency but buy nothing
    if (r.urgency === "Critical" && r.action === "Reorder") urgentCritical++;
    const isCrit = isCritical(r.criticality);
    if (isCrit && r.stocked && r.stockout_risk >= 0.5) criticalAtRisk++;
    if (r.flags.includes("Convert to Stock Item")) toStock++;
    if (r.flags.includes("Convert to Non Stock")) toNonStock++;
    const h = health.get(r.health) ?? { count: 0, value: 0 };
    h.count++;
    h.value += value;
    health.set(r.health, h);
    const c = crit.get(r.criticality) ?? { materials: 0, stockValue: 0, reorder: 0, atRisk: 0 };
    c.materials++;
    c.stockValue += value;
    if (r.action === "Reorder") c.reorder++;
    if (r.stocked && r.stockout_risk >= 0.5) c.atRisk++;
    crit.set(r.criticality, c);
    // current practice holds today's stock; the recommended policy holds its average inventory
    cur.holding += p.holdingRate * value;
    cur.risk += r.current_cost.risk;
    cur.stockouts += r.current_cost.stockouts;
    cur.downtimeEvents += r.current_cost.stockouts * r.downtime_prob;
    rec.holding += r.cost.holding;
    rec.risk += r.cost.risk;
    rec.stockouts += r.cost.stockouts;
    rec.downtimeEvents += r.cost.stockouts * r.downtime_prob;
  });
  cur.total = cur.holding + cur.risk;
  rec.total = rec.holding + rec.risk;
  return {
    materials: recs.length,
    currentStockValue,
    currentStockValuePo,
    targetInventoryValue,
    excessValue,
    excessValuePo,
    reorderValue,
    transfer,
    workingCapitalRelease: excessValue,
    current: cur,
    recommended: rec,
    actions,
    urgentCritical,
    criticalAtRisk,
    health: HEALTH_ORDER.filter((s) => health.has(s)).map((s) => ({ status: s, ...health.get(s)! })),
    byCriticality: CRITS.map((k) => ({ crit: k, ...(crit.get(k) ?? { materials: 0, stockValue: 0, reorder: 0, atRisk: 0 }) })),
    stockedChange: { toStock, toNonStock },
    governance: gov,
  };
}

export const FRONTIER_LEVELS = [0.8, 0.85, 0.9, 0.95, 0.97, 0.99, 0.995, 0.999];

export function frontier(p: Params) {
  const recs = getRecommendations(p);
  const stocked = new Set(recs.filter((r) => r.stocked).map((r) => r.material_no));
  const mats = getMaterials();
  const planned = getPlanned();
  const scale = getImpact().scale;
  return FRONTIER_LEVELS.map((s) => frontierPoint(mats, planned, p, s, stocked, scale));
}

export interface IdenticalGroup {
  description: string;
  unit: string;
  paradox: boolean;
  stockValue: number;
  transferUnits: number;
  members: { material_no: number; stock: number; issueLines: number; action: Action; criticality: Crit; transfer_qty: number }[];
}

/** Groups of material numbers with an identical description and unit; "paradox" = one is empty while another holds stock. */
export function identicalGroups(p: Params): IdenticalGroup[] {
  const byId = new Map(getRecommendations(p).map((r) => [r.material_no, r]));
  const seen = new Set<number>();
  const out: IdenticalGroup[] = [];
  for (const [id, twins] of getTwins()) {
    if (seen.has(id)) continue;
    const ids = [id, ...twins];
    ids.forEach((x) => seen.add(x));
    const rs = ids.map((x) => byId.get(x)).filter((r): r is Recommendation => !!r);
    if (!rs.length) continue;
    out.push({
      description: rs[0].description,
      unit: rs[0].unit,
      paradox: rs.some((r) => r.stock <= 0) && rs.some((r) => r.stock > 0),
      stockValue: rs.reduce((a, r) => a + r.stock * r.price, 0),
      transferUnits: rs.reduce((a, r) => a + r.transfer_qty, 0),
      members: rs
        .map((r) => ({ material_no: r.material_no, stock: r.stock, issueLines: getMaterial(r.material_no)?.hist_lines ?? 0, action: r.action, criticality: r.criticality, transfer_qty: r.transfer_qty }))
        .sort((a, b) => b.issueLines - a.issueLines),
    });
  }
  return out.sort((a, b) => Number(b.paradox) - Number(a.paradox) || b.transferUnits - a.transferUnits || b.members.reduce((s, m) => s + m.issueLines, 0) - a.members.reduce((s, m) => s + m.issueLines, 0));
}

export function getMaterial(id: number): MaterialRow | undefined {
  return getMaterials().find((m) => m.material_no === id);
}

export function materialDetail(id: number, p: Params) {
  const m = getMaterial(id);
  if (!m) return null;
  const planned = getPlanned().get(id);
  const rec = getRecommendations(p).find((r) => r.material_no === id)!;
  return {
    material: m,
    rec,
    curve: costCurve(m, planned, p, getImpact().scale),
    funclocs: all<{ funcloc: string; description: string; criticality: string; equipment_class: string; installed_qty: number; notif_count: number; failure_rate_yr: number }>(
      `SELECT f.funcloc, f.description, f.criticality, f.equipment_class, mf.installed_qty, f.notif_count, f.failure_rate_yr
       FROM material_funcloc mf JOIN funcloc f ON f.funcloc = mf.funcloc
       WHERE mf.material_no = ? ORDER BY CASE f.criticality WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, f.notif_count DESC LIMIT 50`,
      id
    ),
    history: all<{ month: string; unplanned: number; preventive: number; turnaround: number }>(
      "SELECT month, unplanned, preventive, turnaround FROM consumption_monthly WHERE material_no = ? ORDER BY month",
      id
    ),
    forecast: all<{ month: string; unplanned: number; planned: number; total: number; p10: number; p90: number }>(
      "SELECT month, unplanned, planned, total, p10, p90 FROM forecast_monthly WHERE material_no = ? ORDER BY month",
      id
    ),
    movements: all<{ posting_date: string; qty: number; order_no: number; order_type: string }>(
      "SELECT posting_date, qty, order_no, order_type FROM movement WHERE material_no = ? ORDER BY posting_date DESC LIMIT 40",
      id
    ),
    abnormal: all<{ posting_date: string; qty: number; threshold: number }>(
      "SELECT posting_date, qty, CAST(threshold AS REAL) threshold FROM demand_event WHERE material_no = ? AND abnormal = 1 ORDER BY posting_date",
      id
    ),
    planned: all<{ due_date: string; funcloc: string; task: string; qty: number }>(
      "SELECT due_date, funcloc, task, qty FROM planned_demand WHERE material_no = ? ORDER BY due_date LIMIT 40",
      id
    ),
    purchases: all<{ pr_date: string; pr_type: string; pr_type_label: string; qty: number; supplier_name: string; unit_price_idr: number; po_delivery_date: string; lead_time_days: number; is_open: number }>(
      `SELECT pr_date, pr_type, pr_type_label, qty, supplier_name, unit_price_idr, po_delivery_date, lead_time_days, is_open
       FROM po_line WHERE material_no = ? ORDER BY pr_date DESC LIMIT 30`,
      id
    ),
    notifications: all<{ notification_date: string; notif_type: string; priority: string; funcloc: string; description: string; status: string }>(
      `SELECT n.notification_date, n.notif_type, n.priority, n.funcloc, n.description, n.status
       FROM notification n JOIN material_funcloc mf ON mf.funcloc = n.funcloc
       WHERE mf.material_no = ? ORDER BY n.notification_date DESC LIMIT 25`,
      id
    ),
  };
}

export function consumptionByType() {
  return all<{ month: string; order_type: string; lines: number; qty: number }>(
    "SELECT month, order_type, lines, qty FROM consumption_by_type ORDER BY month"
  );
}

export function forecastAggregate() {
  return all<{ month: string; unplanned: number; planned: number; total: number }>(
    "SELECT month, SUM(unplanned) unplanned, SUM(planned) planned, SUM(total) total FROM forecast_monthly GROUP BY month ORDER BY month"
  );
}

export function demandClasses() {
  return all<{ demand_class: string; materials: number; forecast_12m: number; with_stock: number }>(
    `SELECT demand_class, COUNT(*) materials, SUM(forecast_12m) forecast_12m, SUM(stock > 0) with_stock
     FROM material GROUP BY demand_class ORDER BY materials DESC`
  );
}

export function forecastMethods() {
  return all<{ forecast_method: string; materials: number }>(
    "SELECT forecast_method, COUNT(*) materials FROM material GROUP BY forecast_method ORDER BY materials DESC"
  );
}

export function backtest() {
  return all<{ method: string; wape: number; bias: number; auc_occurrence: number; materials_evaluated: number; train_window: string; test_window: string }>(
    "SELECT * FROM backtest"
  );
}

export function plannedSummary() {
  return all<{ month: string; task_category: string; events: number; materials: number; qty: number }>(
    `SELECT substr(due_date, 1, 7) month, task_category, COUNT(*) events, COUNT(DISTINCT material_no) materials, SUM(qty) qty
     FROM planned_demand GROUP BY 1, 2 ORDER BY 1`
  );
}

export function upcomingTasks(limit = 15) {
  return all<{ next_due: string; funcloc: string; fl_description: string; task: string; abc_indicator: string; part_categories: string }>(
    `SELECT next_due, funcloc, fl_description, task, abc_indicator, part_categories FROM mplan_item
     WHERE consumes_parts = 1 AND next_due IS NOT NULL ORDER BY next_due LIMIT ?`,
    limit
  );
}

export function mlMetrics() {
  return all<{ model: string; auc: number; avg_precision: number; brier: number | null; top_decile_precision: number; base_rate: number; rows: number }>(
    "SELECT * FROM ml_metrics"
  );
}

export function mlCalibration() {
  return all<{ bin: string; parts: number; predicted: number; observed: number }>("SELECT * FROM ml_calibration");
}

export function mlImportance() {
  return all<{ feature: string; description: string; importance: number }>("SELECT * FROM ml_importance ORDER BY importance DESC");
}

export function mlFeatures(id: number) {
  return one<Record<string, number>>("SELECT * FROM ml_features WHERE material_no = ?", id);
}

export function dataQuality() {
  return all<{ dataset: string; check_name: string; result: string; action: string }>("SELECT * FROM data_quality");
}

export function assumptions() {
  return all<{ area: string; name: string; value: string; note: string }>("SELECT * FROM assumption");
}

/** Numbers behind the "data gaps" table, computed from the database. */
export function dataGaps() {
  const r = one<{ mplan_with_bom: number; estimated: number; suppliers: number }>(
    `SELECT (SELECT AVG(funcloc IN (SELECT funcloc FROM material_funcloc)) FROM mplan_item) mplan_with_bom,
            (SELECT AVG(price_source != 'PO history') FROM material) estimated,
            (SELECT COUNT(*) FROM supplier) suppliers`
  )!;
  return { mplanWithBom: r.mplan_with_bom, estimatedPrice: r.estimated, suppliers: r.suppliers };
}

export function tableCounts() {
  const tables = all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return tables.map((t) => ({ name: t.name, rows: one<{ n: number }>(`SELECT COUNT(*) n FROM "${t.name}"`)!.n }));
}

export function suppliers(limit = 12) {
  return all<{ supplier_name: string; po_lines: number; materials: number; lt_median: number; on_time_rate: number; avg_slip_days: number }>(
    "SELECT supplier_name, po_lines, materials, lt_median, on_time_rate, avg_slip_days FROM supplier ORDER BY po_lines DESC LIMIT ?",
    limit
  );
}
