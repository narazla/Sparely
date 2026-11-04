/**
 * Dynamic inventory optimization engine.
 *
 * For every spare part it turns the demand model (from the pipeline) plus lead
 * time, price and criticality into a policy: stock or not, service level,
 * safety stock, reorder point (= recommended Min), order quantity and Max.
 * In "optimize" mode the service level is chosen per part to minimize
 * holding + ordering + downtime-risk cost; the same cost model is used to
 * evaluate today's static Min-Max so both can be compared like for like.
 */
import { LONG_LEAD_DAYS, SCE_MIN_SPARE } from "./rules";
import { normCdf, normInv, poissonCdf, poissonQuantile } from "./stats";
import { isCritical, type Action, type CostBreakdown, type Crit, type Health, type MaterialRow, type Params, type Recommendation } from "./types";

export const SL_GRID = [0.5, 0.75, 0.85, 0.9, 0.95, 0.975, 0.99, 0.995, 0.999];
const CRIT_WEIGHT: Record<Crit, number> = { A: 1, B: 0.8, C: 0.45, S: 0.2 };
/**
 * Relative chance that a stockout actually stops production, by criticality.
 * The absolute level is calibrated (impactScale) so that today's policy
 * reproduces the emergency notifications observed in the data.
 */
export const IMPACT_WEIGHT: Record<Crit, number> = { A: 1, B: 0.5, C: 0.15, S: 0.05 };
const SLOW_MOVING_DAYS = 180;
/** ML early-warning threshold; its hit rate on the hold-out is read from ml_calibration and shown in the app. */
export const ML_WARNING = 0.3;

/** Safety-critical element: the part is installed on a safety or shutdown valve. */
export const isSce = (m: Pick<MaterialRow, "n_funcloc_sce">) => (m.n_funcloc_sce ?? 0) > 0;
/**
 * Class whose downtime risk the cost model uses. A safety-critical part counts as A whatever the
 * criticality of its equipment: without the part the valve cannot be returned to service.
 */
export const riskClass = (m: Pick<MaterialRow, "criticality" | "n_funcloc_sce">): Crit => (isSce(m) ? "A" : m.criticality);

export interface PlannedEvent {
  offset: number; // days after as-of
  qty: number;
}

export interface Ctx {
  L: number;
  sL: number;
  lam: number;
  z: number;
  mu: number;
  varD: number;
  plannedLT: number;
  annual: number;
  mL: number;
  vL: number;
  slow: boolean;
  price: number;
  h: number;
  K: number;
  /** probability that one stockout of this part stops production */
  downtimeProb: number;
  emergencyDays: number;
  stockoutCost: number;
}

export function context(m: MaterialRow, planned: PlannedEvent[] | undefined, p: Params, impactScale: number): Ctx {
  const L = Math.max(1, m.lt_mean * p.leadTimeFactor);
  const sL = Math.max(0, m.lt_std * p.leadTimeFactor);
  const lam = m.occ_rate * p.demandFactor;
  const z = Math.max(1, m.size_mean);
  const mu = lam * z;
  const varD = m.var_day * p.demandFactor;
  let plannedLT = 0;
  for (const e of planned ?? []) if (e.offset <= L) plannedLT += e.qty * p.demandFactor;
  const annual = mu * 365 + m.planned_qty_12m * p.demandFactor;
  const mL = mu * L + plannedLT;
  const vL = L * varD + mu * mu * sL * sL;
  // a stockout that stops production lasts until an expedited part arrives (fastest observed deliveries)
  const emergencyDays = Math.max(p.emergencyMinDays, m.lt_fast * p.leadTimeFactor);
  const price = Math.max(1, m.price_idr);
  const rc = riskClass(m);
  const downtimeProb = Math.min(1, IMPACT_WEIGHT[rc] * impactScale);
  return {
    L, sL, lam, z, mu, varD, plannedLT, annual, mL, vL,
    slow: lam * L < 3,
    price,
    h: p.holdingRate,
    K: p.orderCost,
    downtimeProb,
    emergencyDays,
    // one stockout = chance the equipment waits for an expedited part + emergency price premium on one demand
    stockoutCost: downtimeProb * p.downtimeCostPerDay[rc] * emergencyDays + p.emergencyPremium * price * z,
  };
}

/** Reorder point that covers lead-time demand with probability `s`. */
export function reorderPoint(c: Ctx, s: number): number {
  if (c.slow) return Math.ceil(poissonQuantile(s, c.lam * c.L) * c.z + c.plannedLT);
  return Math.ceil(c.mL + normInv(s) * Math.sqrt(c.vL));
}

/** Probability that `level` units cover lead-time demand. */
export function serviceAt(c: Ctx, level: number): number {
  if (level < 0) return 0;
  if (c.slow) return poissonCdf(Math.floor((level - c.plannedLT) / c.z), c.lam * c.L);
  if (c.vL <= 0) return level >= c.mL ? 1 : 0;
  return normCdf((level - c.mL) / Math.sqrt(c.vL));
}

export function orderQuantity(c: Ctx): number {
  if (c.annual <= 0) return Math.ceil(c.z);
  const eoq = Math.sqrt((2 * c.annual * c.K) / (c.h * c.price));
  const q = Math.min(Math.max(eoq, c.annual / 12), Math.max(c.annual, c.z));
  return Math.ceil(Math.max(q, c.z));
}

export function costOf(c: Ctx, rop: number, q: number): CostBreakdown {
  const sl = serviceAt(c, rop);
  const ss = Math.max(0, rop - c.mL);
  const avgInventory = ss + q / 2;
  const cycles = c.annual > 0 ? c.annual / q : 0;
  const stockouts = cycles * (1 - sl);
  const holding = c.h * c.price * avgInventory;
  const ordering = c.K * cycles;
  const risk = stockouts * c.stockoutCost;
  return { holding, ordering, risk, total: holding + ordering + risk, stockouts, serviceLevel: sl, avgInventory };
}

/** Not stocking: every unplanned demand becomes an emergency buy. Planned demand is bought ahead. */
export function noStockCost(c: Ctx): CostBreakdown {
  const events = c.lam * 365;
  const risk = events * c.stockoutCost;
  const ordering = c.K * events;
  return { holding: 0, ordering, risk, total: risk + ordering, stockouts: events, serviceLevel: 0, avgInventory: 0 };
}

export interface Policy {
  stocked: boolean;
  sl: number;
  rop: number;
  q: number;
  max: number;
  ss: number;
  cost: CostBreakdown;
  /** kept only because the part is safety-critical (the cost model alone would not stock it) */
  floor?: boolean;
}

/** A safety-critical part that the cost model would not stock still keeps one spare on the shelf. */
function safetyFloor(c: Ctx): Policy {
  const k = costOf(c, 0, SCE_MIN_SPARE);
  // the spare sits on the shelf until it is used: hold the whole unit, not half an order cycle
  const holding = c.h * c.price * SCE_MIN_SPARE;
  return {
    stocked: true, sl: k.serviceLevel, rop: 0, q: SCE_MIN_SPARE, max: SCE_MIN_SPARE, ss: 0, floor: true,
    cost: { ...k, holding, avgInventory: SCE_MIN_SPARE, total: holding + k.ordering + k.risk },
  };
}

export function choosePolicy(c: Ctx, m: MaterialRow, p: Params): Policy {
  const q = orderQuantity(c);
  const candidates = p.mode === "fixed" ? [p.serviceLevel[riskClass(m)]] : SL_GRID;
  let best: Policy | null = null;
  for (const s of candidates) {
    const rop = Math.max(0, reorderPoint(c, s));
    const cost = costOf(c, rop, q);
    // on ties (slow movers where several targets give the same reorder point) keep the safer one
    if (!best || cost.total <= best.cost.total + 1e-6) {
      best = { stocked: true, sl: cost.serviceLevel, rop, q, max: rop + q, ss: Math.max(0, rop - c.mL), cost };
    }
  }
  const none = noStockCost(c);
  if (best && none.total < best.cost.total) {
    best = { stocked: false, sl: 0, rop: 0, q: 0, max: 0, ss: 0, cost: none };
  }
  // a missing part for a safety or shutdown valve is a process-safety risk, not only a cost
  if (isSce(m) && best!.max < SCE_MIN_SPARE) return safetyFloor(c);
  return best!;
}

/** Today's static policy, evaluated with the same cost model. */
export function currentCost(c: Ctx, m: MaterialRow): CostBreakdown {
  if (m.mrp_type !== "Stock Item" || m.max_qty <= 0) return noStockCost(c);
  const q = Math.max(1, m.max_qty - m.min_qty);
  return costOf(c, m.min_qty, q);
}

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(days)));
  return d.toISOString().slice(0, 10);
};

const fmtQty = (v: number) => (v >= 100 ? Math.round(v).toLocaleString("en-US") : Number.isInteger(v) ? String(v) : v.toFixed(v >= 10 ? 0 : 1));

export function recommend(
  m: MaterialRow,
  planned: PlannedEvent[] | undefined,
  p: Params,
  asOf: string,
  impactScale: number
): Recommendation {
  const c = context(m, planned, p, impactScale);
  const pol = choosePolicy(c, m, p);
  const cur = currentCost(c, m);
  const ip = m.stock + m.on_order_qty;
  const daily = c.annual / 365;
  const flags: string[] = [];
  const reasons: string[] = [];

  const stockoutRisk = c.annual <= 0 ? 0 : 1 - serviceAt(c, ip);
  const nonMoving = m.hist_lines === 0;
  const slowMoving = !nonMoving && (m.days_since_last_issue ?? 0) > SLOW_MOVING_DAYS;
  const mlWarning = (m.p_demand_90d ?? 0) >= ML_WARNING;
  const sce = isSce(m);
  const rc = riskClass(m);
  // emergency buying cannot beat a lead time this long; only observed lead times count, not category estimates
  const longLead = isCritical(rc) && m.lt_source !== "Category estimate" && m.lt_p80 > LONG_LEAD_DAYS;
  // a part never issued, with no planned job and no ML warning is an insurance decision for reliability
  // engineers, not an automatic PO; safety-critical parts are not optional and always keep their spare
  const insuranceCandidate = nonMoving && c.plannedLT <= 0 && m.planned_qty_12m <= 0 && !mlWarning && !sce;

  let action: Action = "Maintain";
  let urgency: Recommendation["urgency"] = null;
  let orderQty = 0;
  let excessQty = 0;
  let orderBy: string | null = null;

  // Parts in the last turnaround's scope keep that quantity: the routine policy excludes turnaround
  // demand, so without this the stock needed for the next turnaround would be "excess".
  const tamReserve = Math.max(0, m.tam_qty ?? 0);
  const tamOnly = tamReserve > 0 && (m.hist_qty_total ?? 0) <= (m.hist_qty_turnaround ?? 0);
  const keepLevel = Math.max(pol.stocked ? pol.max : 0, tamReserve);

  if (!pol.stocked) {
    if (m.stock > keepLevel && !mlWarning) {
      action = "Reduce";
      excessQty = m.stock - keepLevel;
    } else if (mlWarning && ip <= 0) {
      // buy-on-demand part that the ML model expects to be needed soon: prepare the PR early
      action = "Monitor";
      orderBy = asOf;
    }
  } else if (ip <= pol.rop && insuranceCandidate) {
    action = "Monitor";
    flags.push("Insurance spare candidate");
  } else if (ip <= pol.rop) {
    action = "Reorder";
    orderQty = Math.max(Math.ceil(pol.max - ip), 1);
    orderBy = asOf;
    urgency = m.stock < c.mL && isCritical(rc) ? "Critical" : m.stock < c.mL || (sce && m.stock <= 0) ? "High" : "Normal";
  } else if (m.stock > keepLevel) {
    action = "Reduce";
    excessQty = m.stock - keepLevel;
  } else if (daily > 0 && ip - pol.rop <= 0.5 * pol.q) {
    action = "Monitor";
    orderBy = addDays(asOf, (ip - pol.rop) / daily);
  }
  if (action === "Maintain" && (slowMoving || m.abnormal_events > 0)) action = "Monitor";

  let health: Health;
  if (m.stock <= 0) health = !pol.stocked ? "No stock needed" : insuranceCandidate || (sce && nonMoving) ? "Insurance gap" : "Stockout";
  else if (tamOnly && m.stock <= keepLevel) health = "TAM reserve";
  else if (nonMoving) {
    if (pol.stocked && isCritical(rc) && m.stock <= pol.max) health = "Critical insurance spare";
    else if (m.planned_qty_12m <= 0 && !isCritical(rc)) health = "Potentially obsolete";
    else health = "Non-moving";
  } else if (slowMoving) health = "Slow-moving";
  else if (m.stock > pol.max) health = "Excess";
  else if (ip <= pol.rop) health = "Below reorder point";
  else health = "Healthy";

  if (sce) flags.push("Safety-critical (SCE)");
  if (longLead) flags.push("Long-lead");
  if (mlWarning) flags.push("ML early warning");
  // only recommend a master-data change when the data shows repeated need (2+ months) or a planned job;
  // never-used parts are an insurance decision instead
  if (m.mrp_type === "Non Stock" && pol.stocked && ((m.active_months ?? 0) >= 2 || m.planned_qty_12m > 0)) flags.push("Convert to Stock Item");
  if (tamReserve > 0) flags.push(`Last turnaround used ${fmtQty(tamReserve)}`);
  if (m.mrp_type === "Stock Item" && !pol.stocked) flags.push("Convert to Non Stock");
  if ((m.n_suppliers ?? 0) === 1) flags.push("Single source");
  if (m.abnormal_events > 0) flags.push("Abnormal consumption");
  if (m.on_order_qty > 0) flags.push("Open PO");
  if (c.plannedLT > 0) flags.push("Planned demand in lead time");
  if (m.price_source !== "PO history") flags.push("Price estimated");
  if (m.lt_source === "Category estimate") flags.push("Lead time estimated");

  const plannedPart = m.planned_qty_12m * p.demandFactor;
  if (sce)
    reasons.push(
      `Safety-critical element: installed on ${m.n_funcloc_sce} safety or shutdown valve location(s)` +
        (m.criticality !== "A" ? ` (equipment criticality ${m.criticality})` : "") +
        `. Downtime risk is costed as class A and at least ${SCE_MIN_SPARE} spare is always kept; any reduction needs Management sign-off.`
    );
  reasons.push(
    `Forecast ${fmtQty(c.annual)} ${m.unit}/year: ${fmtQty(c.mu * 365)} unplanned (${m.forecast_method.toLowerCase()})` +
      (plannedPart > 0 ? ` + ${fmtQty(plannedPart)} from the maintenance plan.` : ".")
  );
  reasons.push(
    `Lead time ~${Math.round(c.L)} days; expected demand during lead time ${fmtQty(c.mL)}` +
      (c.plannedLT > 0 ? ` (incl. ${fmtQty(c.plannedLT)} planned)` : "") + "."
  );
  if (pol.floor) {
    reasons.push(`Buying on demand would cost less, but a safety-critical part keeps ${SCE_MIN_SPARE} spare: reorder only when the shelf is empty.`);
  } else if (pol.stocked) {
    reasons.push(
      `A ${(pol.sl * 100).toFixed(1)}% service level gives the lowest holding + downtime-risk cost: reorder at ${fmtQty(pol.rop)}, order up to ${fmtQty(pol.max)}.`
    );
    if (insuranceCandidate && ip <= pol.rop)
      reasons.push("Never issued in 17 months: review with reliability engineering before buying an insurance spare.");
  } else {
    reasons.push("Expected downtime risk is lower than the cost of holding this part, so buying on demand is cheaper.");
  }
  if (action === "Reorder") reasons.push(`On hand ${fmtQty(m.stock)} + on order ${fmtQty(m.on_order_qty)} is at or below the reorder point: order ${fmtQty(orderQty)} now.`);
  if (action === "Reduce")
    reasons.push(
      `Stock ${fmtQty(m.stock)} exceeds the level to keep (${fmtQty(keepLevel)}) by ${fmtQty(excessQty)}` +
        (tamReserve > (pol.stocked ? pol.max : 0) ? `; the level includes the ${fmtQty(tamReserve)} used in the last turnaround.` : ".")
    );
  if (health === "TAM reserve")
    reasons.push(`Used only during the last turnaround (${fmtQty(tamReserve)} ${m.unit}): keep it for the next one instead of treating it as slow-moving.`);
  if (health === "Critical insurance spare") reasons.push("No issue in 17 months, but it protects critical equipment: keep it.");
  if (longLead)
    reasons.push(
      `Long lead time: 80% of deliveries took up to ${Math.round(m.lt_p80)} days and the fastest seen in its category ${Math.round(m.lt_fast)} days` +
        ((m.n_suppliers ?? 0) === 1 ? ", from a single supplier" : "") +
        ". Emergency buying cannot prevent downtime: plan ahead or hold as a capital spare."
    );
  if (m.n_funcloc_critical > 0) reasons.push(`Installed on ${m.n_funcloc} FuncLoc(s), ${m.n_funcloc_critical} of them criticality A/B.`);
  if (mlWarning)
    reasons.push(
      `ML early warning: ${(m.p_demand_90d * 100).toFixed(0)}% probability of demand in the next 90 days` +
        (!pol.stocked && ip <= 0 ? " — prepare the purchase requisition before it is needed." : ".")
    );

  const priority =
    action === "Reorder"
      ? 1000 * stockoutRisk * CRIT_WEIGHT[rc] + (urgency === "Critical" ? 500 : 0)
      : action === "Reduce"
        ? (excessQty * c.price) / 1e9
        : stockoutRisk * CRIT_WEIGHT[rc];

  return {
    material_no: m.material_no,
    description: m.description,
    category: m.category,
    unit: m.unit,
    criticality: m.criticality,
    mrp_type: m.mrp_type,
    stock: m.stock,
    on_order: m.on_order_qty,
    price: c.price,
    current_min: m.min_qty,
    current_max: m.max_qty,
    stocked: pol.stocked,
    service_level: pol.sl,
    safety_stock: Math.ceil(pol.ss),
    reorder_point: pol.rop,
    max_level: pol.max,
    order_qty_policy: pol.q,
    lead_time_days: c.L,
    lt_demand: c.mL,
    annual_demand: c.annual,
    planned_in_lt: c.plannedLT,
    inventory_position: ip,
    stockout_risk: stockoutRisk,
    days_of_cover: daily > 0 ? m.stock / daily : null,
    action,
    urgency,
    order_qty: orderQty,
    order_value: orderQty * c.price,
    order_by: orderBy,
    excess_qty: excessQty,
    excess_value: excessQty * c.price,
    transfer_qty: 0,
    transfer_from: [],
    twin_count: 0,
    health,
    sce,
    safety_floor: !!pol.floor,
    long_lead: longLead,
    // set in data.ts once identical stock has been applied (it changes the buy value)
    requires_approval: false,
    flags,
    reasons,
    priority,
    p_demand_90d: m.p_demand_90d ?? 0,
    ml_warning: mlWarning,
    downtime_prob: c.downtimeProb,
    emergency_days: c.emergencyDays,
    cost: pol.cost,
    current_cost: cur,
  };
}

/** Cost of every service level on the grid for one part (detail-page curve). */
export function costCurve(m: MaterialRow, planned: PlannedEvent[] | undefined, p: Params, impactScale: number) {
  const c = context(m, planned, p, impactScale);
  const q = orderQuantity(c);
  const none = noStockCost(c);
  return {
    noStock: none,
    points: SL_GRID.map((s) => {
      const rop = Math.max(0, reorderPoint(c, s));
      return { sl: s, rop, ...costOf(c, rop, q) };
    }),
  };
}

/** Portfolio total for one uniform service level (efficient-frontier point). */
export function frontierPoint(
  rows: MaterialRow[],
  planned: Map<number, PlannedEvent[]>,
  p: Params,
  s: number,
  stocked: Set<number>,
  impactScale: number
) {
  let inv = 0;
  let risk = 0;
  let holding = 0;
  let stockouts = 0;
  let downtimeEvents = 0;
  for (const m of rows) {
    const c = context(m, planned.get(m.material_no), p, impactScale);
    // parts the optimizer would not stock stay unstocked, the rest hold service level s
    let k: CostBreakdown;
    if (stocked.has(m.material_no)) {
      const q = orderQuantity(c);
      k = costOf(c, Math.max(0, reorderPoint(c, s)), q);
    } else {
      k = noStockCost(c);
    }
    inv += k.avgInventory * c.price;
    risk += k.risk;
    holding += k.holding;
    stockouts += k.stockouts;
    downtimeEvents += k.stockouts * c.downtimeProb;
  }
  return { serviceLevel: s, inventoryValue: inv, riskCost: risk, holdingCost: holding, stockouts, downtimeEvents };
}

/**
 * Calibrate how often a stockout stops production: today's policy, run through
 * the demand model, must reproduce the emergency notifications seen in the data.
 */
export function calibrateImpact(rows: MaterialRow[], planned: Map<number, PlannedEvent[]>, p: Params, emergenciesPerYear: number) {
  let weighted = 0;
  for (const m of rows) {
    const c = context(m, planned.get(m.material_no), p, 1);
    weighted += currentCost(c, m).stockouts * IMPACT_WEIGHT[riskClass(m)];
  }
  return weighted > 0 ? emergenciesPerYear / weighted : 0;
}
