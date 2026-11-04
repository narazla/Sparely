import "server-only";
/**
 * Data behind the role workspaces: maintenance job readiness, procurement PR drafts,
 * supplier risk and the impact of the decisions users take. Everything is derived
 * from the SQLite tables and the optimization engine; nothing here is hard-coded.
 */
import { all } from "./db";
import { context, serviceAt } from "./engine";
import { asOf, getImpact, getMaterials, getPlanned, getRecommendations } from "./data";
import { CRIT_RANK, isCritical, type MaterialRow, type Params, type Recommendation } from "./types";

export type DecisionKind = "reorder" | "transfer" | "request" | "tam" | "param" | "reduce" | "insurance";
export interface Decision {
  id: string;
  kind: DecisionKind;
  material_no: number;
  status: "approved" | "rejected";
  qty?: number;
  need_by?: string;
  role: string;
  at: string;
  source?: string;
}

const addDays = (iso: string, d: number) => {
  const x = new Date(iso + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + Math.round(d));
  return x.toISOString().slice(0, 10);
};

let matIndex: Map<number, MaterialRow> | null = null;
function mat(id: number) {
  if (!matIndex) matIndex = new Map(getMaterials().map((m) => [m.material_no, m]));
  return matIndex.get(id);
}

function recIndex(p: Params) {
  return new Map(getRecommendations(p).map((r) => [r.material_no, r]));
}

// ------------------------------------------------------------------ maintenance

export interface JobPart {
  material_no: number;
  description: string;
  unit: string;
  need: number;
  on_hand_for_job: number;
  shortfall: number;
  status: "Ready" | "Covered by open PO" | "Short";
}
export interface Job {
  key: string;
  due_date: string;
  funcloc: string;
  fl_description: string;
  criticality: string;
  task: string;
  task_category: string;
  parts: JobPart[];
  status: "Ready" | "Covered by open PO" | "Short";
}

/**
 * Part readiness of every part-consuming maintenance job due in the window.
 * Stock is allocated to jobs in due-date order; an open PO counts only if it is
 * scheduled to arrive before the job's due date.
 */
export function jobReadiness(days = 90): Job[] {
  const end = addDays(asOf(), days);
  const rows = all<{ material_no: number; funcloc: string; item_no: number; task: string; task_category: string; due_date: string; qty: number; fl_description: string; criticality: string }>(
    `SELECT pd.material_no, pd.funcloc, pd.item_no, pd.task, pd.task_category, pd.due_date, pd.qty,
            f.description fl_description, f.criticality
     FROM planned_demand pd JOIN funcloc f ON f.funcloc = pd.funcloc
     WHERE pd.due_date < ? ORDER BY pd.due_date, pd.funcloc`,
    end
  );
  const used = new Map<number, number>();
  const jobs = new Map<string, Job>();
  for (const r of rows) {
    const m = mat(r.material_no);
    if (!m) continue;
    const need = Math.ceil(r.qty);
    if (need <= 0) continue;
    const before = used.get(r.material_no) ?? 0;
    const poArrives = m.next_delivery != null && m.next_delivery <= r.due_date ? m.on_order_qty : 0;
    const stockLeft = Math.max(0, m.stock - before);
    const withPo = Math.max(0, m.stock + poArrives - before);
    used.set(r.material_no, before + need);
    const status: JobPart["status"] = stockLeft >= need ? "Ready" : withPo >= need ? "Covered by open PO" : "Short";
    const key = `${r.funcloc}|${r.item_no}|${r.due_date}`;
    const job = jobs.get(key) ?? { key, due_date: r.due_date, funcloc: r.funcloc, fl_description: r.fl_description, criticality: r.criticality, task: r.task, task_category: r.task_category, parts: [], status: "Ready" };
    job.parts.push({ material_no: r.material_no, description: m.description, unit: m.unit, need, on_hand_for_job: Math.min(need, withPo), shortfall: Math.max(0, need - withPo), status });
    jobs.set(key, job);
  }
  for (const j of jobs.values()) {
    j.status = j.parts.some((x) => x.status === "Short") ? "Short" : j.parts.some((x) => x.status === "Covered by open PO") ? "Covered by open PO" : "Ready";
  }
  return [...jobs.values()];
}


/** Never-issued parts with no stock where the cost model favours holding some: critical ones first. */
export interface TamLine {
  material_no: number;
  description: string;
  unit: string;
  criticality: string;
  need: number;
  stock: number;
  routine_use: number;
  arriving: number;
  available: number;
  shortfall: number;
  shortfall_value: number;
  lt_p80: number;
  order_by: string;
  status: "Ready" | "Order in time" | "Expedite" | "Too late";
}

/**
 * Readiness for the next turnaround, assuming it repeats the scope of the last one
 * (parts and quantities issued on turnaround orders in the detected window). The date is
 * a planner input. Stock left on the day = on hand + open POs arriving before it − expected
 * routine and planned use until then. Order-by = turnaround start − P80 lead time.
 */
export function tamReadiness(p: Params, tamDate: string) {
  const day = asOf();
  const days = Math.max(0, (Date.parse(tamDate) - Date.parse(day)) / 86_400_000);
  const recs = recIndex(p);
  const planned = getPlanned();
  const scope = all<{ material_no: number; tam_qty: number }>("SELECT material_no, tam_qty FROM tam_scope");
  const lines: TamLine[] = [];
  for (const s of scope) {
    const m = mat(s.material_no);
    const r = recs.get(s.material_no);
    if (!m || !r) continue;
    let plannedUse = 0;
    for (const e of planned.get(m.material_no) ?? []) if (e.offset <= days) plannedUse += e.qty * p.demandFactor;
    const routine = m.mu_day * p.demandFactor * days + plannedUse;
    const arriving = m.next_delivery != null && m.next_delivery <= tamDate ? m.on_order_qty : 0;
    const available = Math.max(0, m.stock + arriving + r.transfer_qty - routine);
    const need = Math.ceil(s.tam_qty);
    const shortfall = Math.max(0, Math.ceil(need - available));
    const lt80 = Math.max(1, Math.round((m.lt_p80 || m.lt_mean) * p.leadTimeFactor));
    const orderBy = addDays(tamDate, -lt80);
    const status: TamLine["status"] =
      shortfall === 0 ? "Ready" : orderBy >= day ? "Order in time" : addDays(day, m.lt_fast * p.leadTimeFactor) <= tamDate ? "Expedite" : "Too late";
    lines.push({
      material_no: m.material_no, description: m.description, unit: m.unit, criticality: m.criticality, need, stock: m.stock,
      routine_use: routine, arriving, available, shortfall, shortfall_value: shortfall * m.price_idr, lt_p80: lt80, order_by: orderBy, status,
    });
  }
  const order = { "Too late": 0, Expedite: 1, "Order in time": 2, Ready: 3 };
  lines.sort((a, b) => order[a.status] - order[b.status] || CRIT_RANK[b.criticality as keyof typeof CRIT_RANK] - CRIT_RANK[a.criticality as keyof typeof CRIT_RANK] || b.shortfall_value - a.shortfall_value);
  const ready = lines.filter((l) => l.status === "Ready").length;
  return {
    date: tamDate,
    lines,
    parts: lines.length,
    ready,
    readiness: lines.length ? ready / lines.length : 1,
    shortValue: lines.reduce((a, l) => a + l.shortfall_value, 0),
    criticalShort: lines.filter((l) => l.shortfall > 0 && isCritical(l.criticality)).length,
    late: lines.filter((l) => l.status === "Too late" || l.status === "Expedite").length,
  };
}

/** Owning department (Purchasing Group) per part: from its own PO history, else the dominant group of its category. */
export function departmentSummary(p: Params) {
  const { buying, groupByCategory } = buyingHabits();
  const rows = new Map<string, { group: string; parts: number; fromPo: number; reorders: number; reorderValue: number; excessValue: number; transfers: number }>();
  for (const r of getRecommendations(p)) {
    const own = buying.get(r.material_no)?.group;
    const g = own ?? groupByCategory.get(r.category) ?? "Unassigned";
    const x = rows.get(g) ?? { group: g, parts: 0, fromPo: 0, reorders: 0, reorderValue: 0, excessValue: 0, transfers: 0 };
    x.parts++;
    if (own) x.fromPo++;
    if (r.action === "Reorder") {
      x.reorders++;
      x.reorderValue += r.order_value;
    }
    if (r.transfer_qty > 0) x.transfers++;
    x.excessValue += r.excess_value;
    rows.set(g, x);
  }
  return [...rows.values()].sort((a, b) => b.excessValue - a.excessValue);
}

export function insuranceGaps(p: Params): Recommendation[] {
  return getRecommendations(p)
    .filter((r) => r.health === "Insurance gap")
    .sort((a, b) => CRIT_RANK[b.criticality] - CRIT_RANK[a.criticality] || b.annual_demand * b.downtime_prob - a.annual_demand * a.downtime_prob);
}

export function mlWarnings(p: Params): Recommendation[] {
  return getRecommendations(p)
    .filter((r) => r.ml_warning && r.inventory_position <= 0)
    .sort((a, b) => b.p_demand_90d - a.p_demand_90d);
}

export function abnormalRecent(days = 90) {
  return all<{ material_no: number; description: string; posting_date: string; qty: number; threshold: number; unit: string }>(
    `SELECT e.material_no, m.description, e.posting_date, e.qty, CAST(e.threshold AS REAL) threshold, m.unit
     FROM demand_event e JOIN material m USING (material_no)
     WHERE e.abnormal = 1 AND e.posting_date >= ? ORDER BY e.posting_date DESC`,
    addDays(asOf(), -days)
  );
}

// ------------------------------------------------------------------ procurement

let buying: Map<number, { group: string; prType: string }> | null = null;
let groupByCategory: Map<string, string> | null = null;

/** Most frequent purchasing group / PR type used for each part (and per category as fallback). */
function buyingHabits() {
  if (!buying) {
    const mode = <K>(rows: { k: K; v: string; n: number }[]) => {
      const best = new Map<K, { v: string; n: number }>();
      for (const r of rows) if (!best.has(r.k) || best.get(r.k)!.n < r.n) best.set(r.k, { v: r.v, n: r.n });
      return best;
    };
    const g = mode(all<{ k: number; v: string; n: number }>("SELECT material_no k, purchasing_group v, COUNT(*) n FROM po_line GROUP BY 1, 2"));
    const t = mode(all<{ k: number; v: string; n: number }>("SELECT material_no k, pr_type v, COUNT(*) n FROM po_line GROUP BY 1, 2"));
    buying = new Map([...g.keys()].map((k) => [k, { group: g.get(k)!.v, prType: t.get(k)?.v ?? "PR03" }]));
    const c = mode(all<{ k: string; v: string; n: number }>(
      "SELECT m.category k, p.purchasing_group v, COUNT(*) n FROM po_line p JOIN material m USING (material_no) GROUP BY 1, 2"
    ));
    groupByCategory = new Map([...c.entries()].map(([k, v]) => [k, v.v]));
  }
  return { buying: buying!, groupByCategory: groupByCategory! };
}

export interface PrLine {
  material_no: number;
  description: string;
  unit: string;
  qty: number;
  need_by: string;
  expected_delivery: string;
  pr_type: string;
  purchasing_group: string;
  purchasing_group_source: string;
  supplier: string;
  unit_price: number;
  price_source: string;
  value: number;
  lead_time_days: number;
  late_risk: boolean;
  single_source: boolean;
  criticality: string;
  source: string;
}

/** Turn approved decisions into purchase-requisition lines, filled from each part's own procurement history. */
export function prDraft(items: { material_no: number; qty: number; need_by?: string; source?: string }[]): PrLine[] {
  const { buying, groupByCategory } = buyingHabits();
  const day = asOf();
  return items.flatMap((it) => {
    const m = mat(it.material_no);
    if (!m || !(it.qty > 0)) return [];
    const habit = buying.get(m.material_no);
    const lt = Math.round(m.lt_mean);
    const expected = addDays(day, lt);
    const needBy = it.need_by ?? expected;
    return [{
      material_no: m.material_no,
      description: m.description,
      unit: m.unit,
      qty: Math.ceil(it.qty),
      need_by: needBy,
      expected_delivery: expected,
      pr_type: habit?.prType ?? "PR03",
      purchasing_group: habit?.group ?? groupByCategory.get(m.category) ?? "MR1",
      purchasing_group_source: habit ? "Part history" : "Category history",
      supplier: m.supplier_name ?? "No supplier history: source new",
      unit_price: m.price_idr,
      price_source: m.price_source,
      value: Math.ceil(it.qty) * m.price_idr,
      lead_time_days: lt,
      late_risk: expected > needBy,
      single_source: (m.n_suppliers ?? 0) === 1,
      criticality: m.criticality,
      source: it.source ?? "Planner",
    }];
  });
}

export function supplierRisk(limit = 15) {
  return all<{ supplier_name: string; parts: number; critical_parts: number; single_source_critical: number; on_time_rate: number; avg_slip_days: number; lt_median: number }>(
    `SELECT s.supplier_name, COUNT(m.material_no) parts,
            SUM(m.criticality IN ('A','B')) critical_parts,
            SUM(m.criticality IN ('A','B') AND m.n_suppliers = 1) single_source_critical,
            s.on_time_rate, s.avg_slip_days, s.lt_median
     FROM supplier s JOIN material m ON m.supplier_code = s.supplier_code
     GROUP BY s.supplier_code ORDER BY single_source_critical * (1.5 - s.on_time_rate) DESC LIMIT ?`,
    limit
  );
}

export function supplierStats() {
  const rows = all<{ on_time_rate: number }>("SELECT on_time_rate FROM supplier ORDER BY on_time_rate");
  return { suppliers: rows.length, onTimeMedian: rows.length ? rows[Math.floor(rows.length / 2)].on_time_rate : 0 };
}

/** Reorders whose open PO is the only thing standing between the plant and a stockout. */
export function expediteList(p: Params) {
  return getRecommendations(p)
    .filter((r) => r.action === "Reorder" && r.on_order > 0 && r.stock < r.lt_demand)
    .map((r) => ({ ...r, next_delivery: mat(r.material_no)?.next_delivery ?? null }))
    .sort((a, b) => b.priority - a.priority);
}

// ------------------------------------------------------------------ management

/** What the decisions taken so far change: money committed, capital released, risk removed. */
export function decisionImpact(decisions: Decision[], p: Params) {
  const recs = recIndex(p);
  const planned = getPlanned();
  const scale = getImpact().scale;
  const out = {
    approved: 0,
    rejected: 0,
    orders: { count: 0, value: 0, critical: 0 },
    transfers: { count: 0, valueAvoided: 0 },
    released: { count: 0, value: 0 },
    params: 0,
    insurance: 0,
    riskAvoided: 0,
    downtimeEventsAvoided: 0,
  };
  for (const d of decisions) {
    if (d.status === "rejected") {
      out.rejected++;
      continue;
    }
    out.approved++;
    const r = recs.get(d.material_no);
    const m = mat(d.material_no);
    if (!r || !m) continue;
    if (d.kind === "reorder" || d.kind === "request" || d.kind === "tam" || d.kind === "insurance" || d.kind === "transfer") {
      const qty = d.qty ?? (d.kind === "transfer" ? r.transfer_qty : r.order_qty);
      if (d.kind === "transfer") {
        // stock moves from an identical material number: availability improves, nothing is bought
        out.transfers.count++;
        out.transfers.valueAvoided += qty * r.price;
      } else {
        out.orders.count++;
        out.orders.value += qty * r.price;
        if (isCritical(r.criticality)) out.orders.critical++;
      }
      if (d.kind === "insurance") out.insurance++;
      const c = context(m, planned.get(m.material_no), p, scale);
      const before = c.annual > 0 ? 1 - serviceAt(c, r.inventory_position) : 0;
      const after = c.annual > 0 ? 1 - serviceAt(c, r.inventory_position + qty) : 0;
      out.riskAvoided += Math.max(0, before - after) * c.stockoutCost;
      out.downtimeEventsAvoided += Math.max(0, before - after) * c.downtimeProb;
    } else if (d.kind === "reduce") {
      out.released.count++;
      out.released.value += r.excess_value;
    } else if (d.kind === "param") {
      out.params++;
    }
  }
  return out;
}
