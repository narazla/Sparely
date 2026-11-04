export type Crit = "A" | "B" | "C" | "S";
/** Equipment criticality, most critical first (A > B > C > S). */
export const CRITS: Crit[] = ["A", "B", "C", "S"];
export const CRIT_RANK: Record<Crit, number> = { A: 4, B: 3, C: 2, S: 1 };
/** "Critical" = the two highest classes. */
export const isCritical = (c: string) => c === "A" || c === "B";

/** One row of the `material` table built by pipeline/build_db.py. */
export interface MaterialRow {
  material_no: number;
  description: string;
  category: string;
  unit: string;
  min_qty: number;
  max_qty: number;
  stock: number;
  mrp_type: "Stock Item" | "Non Stock";
  criticality: Crit;
  n_funcloc: number;
  n_funcloc_critical: number;
  installed_qty_total: number;
  price_idr: number;
  price_source: string;
  lt_n: number;
  lt_mean: number;
  lt_std: number;
  lt_source: string;
  /** fastest realistic (expedited) delivery: 10th percentile lead time of the part's category */
  lt_fast: number;
  /** lead time 80% of deliveries arrive within (own POs if >= 3, else category) — used for order-by dates */
  lt_p80: number;
  /** units issued on turnaround orders during the last turnaround window (0 if not in its scope) */
  tam_qty: number;
  /** safety or shutdown valve locations (SCE tags) the part is installed on; > 0 = safety-critical element */
  n_funcloc_sce: number;
  /** ML early warning: probability of any demand in the next 90 days */
  p_demand_90d: number;
  supplier_code: number | null;
  supplier_name: string | null;
  on_time_rate: number | null;
  n_suppliers: number | null;
  on_order_qty: number;
  next_delivery: string | null;
  hist_qty_total: number;
  hist_lines: number;
  first_issue: string | null;
  last_issue: string | null;
  hist_qty_turnaround: number | null;
  hist_qty_preventive: number | null;
  demand_class: string;
  active_months: number;
  n_events: number;
  abnormal_events: number;
  occ_rate: number;
  size_mean: number;
  size_var: number;
  mu_day: number;
  var_day: number;
  planned_qty_12m: number;
  next_planned_date: string | null;
  days_since_last_issue: number | null;
  forecast_12m: number;
  stock_value_idr: number;
  forecast_method: string;
}

export interface Params {
  /** optimize = pick each part's service level by minimum total cost; fixed = use serviceLevel targets */
  mode: "optimize" | "fixed";
  serviceLevel: Record<Crit, number>;
  /** expected production loss per day an item is unavailable, by equipment criticality (IDR) */
  downtimeCostPerDay: Record<Crit, number>;
  holdingRate: number;
  orderCost: number;
  emergencyMinDays: number;
  emergencyPremium: number;
  demandFactor: number;
  leadTimeFactor: number;
}

/** Transfer = the need is covered by spare stock held under an identical material number. */
export type Action = "Reorder" | "Transfer" | "Reduce" | "Monitor" | "Maintain";
export type Health =
  | "Stockout"
  | "Below reorder point"
  | "Healthy"
  | "Excess"
  | "Slow-moving"
  | "Non-moving"
  | "Potentially obsolete"
  | "Critical insurance spare"
  | "TAM reserve"
  | "Insurance gap"
  | "No stock needed";

export interface CostBreakdown {
  holding: number;
  ordering: number;
  risk: number;
  total: number;
  stockouts: number;
  serviceLevel: number;
  avgInventory: number;
}

export interface Recommendation {
  material_no: number;
  description: string;
  category: string;
  unit: string;
  criticality: Crit;
  mrp_type: string;
  stock: number;
  on_order: number;
  price: number;
  current_min: number;
  current_max: number;
  stocked: boolean;
  service_level: number;
  safety_stock: number;
  reorder_point: number;
  max_level: number;
  order_qty_policy: number;
  lead_time_days: number;
  lt_demand: number;
  annual_demand: number;
  planned_in_lt: number;
  inventory_position: number;
  stockout_risk: number;
  days_of_cover: number | null;
  action: Action;
  urgency: "Critical" | "High" | "Normal" | null;
  order_qty: number;
  order_value: number;
  order_by: string | null;
  excess_qty: number;
  excess_value: number;
  /** units covered by identical parts' spare stock instead of buying */
  transfer_qty: number;
  transfer_from: number[];
  twin_count: number;
  health: Health;
  /** safety-critical element: installed on a safety or shutdown valve */
  sce: boolean;
  /** stocked only because of the safety-critical minimum spare (the cost model alone would buy on demand) */
  safety_floor: boolean;
  /** critical part whose observed lead time makes emergency buying too slow */
  long_lead: boolean;
  /** the recommended buy or reduction needs Management sign-off (see rules.ts) */
  requires_approval: boolean;
  flags: string[];
  reasons: string[];
  priority: number;
  p_demand_90d: number;
  ml_warning: boolean;
  downtime_prob: number;
  emergency_days: number;
  cost: CostBreakdown;
  current_cost: CostBreakdown;
}
