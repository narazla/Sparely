import type { Recommendation } from "./types";

export interface RecFilter {
  action?: string;
  health?: string;
  crit?: string;
  q?: string;
  sort?: string;
  /** sce = safety-critical, longlead = long-lead, signoff = needs Management sign-off */
  tag?: string;
}

export const TAGS: Record<string, { label: string; fn: (r: Recommendation) => boolean }> = {
  sce: { label: "Safety-critical (SCE)", fn: (r) => r.sce },
  longlead: { label: "Long-lead", fn: (r) => r.long_lead },
  signoff: { label: "Needs Management sign-off", fn: (r) => r.requires_approval },
};

export const SORTS: Record<string, { label: string; fn: (a: Recommendation, b: Recommendation) => number }> = {
  priority: { label: "Priority", fn: (a, b) => b.priority - a.priority },
  risk: { label: "Stockout risk", fn: (a, b) => b.stockout_risk - a.stockout_risk },
  order_value: { label: "Order value", fn: (a, b) => b.order_value - a.order_value },
  excess_value: { label: "Excess value", fn: (a, b) => b.excess_value - a.excess_value },
  stock_value: { label: "Stock value", fn: (a, b) => b.stock * b.price - a.stock * a.price },
  demand: { label: "Annual demand", fn: (a, b) => b.annual_demand - a.annual_demand },
};

export function filterRecs(recs: Recommendation[], f: RecFilter): Recommendation[] {
  const q = f.q?.trim().toLowerCase();
  const crits = f.crit ? f.crit.split(",") : null;
  const out = recs.filter(
    (r) =>
      (!f.action || r.action === f.action) &&
      (!f.health || r.health === f.health) &&
      (!crits || crits.includes(r.criticality)) &&
      (!f.tag || !TAGS[f.tag] || TAGS[f.tag].fn(r)) &&
      (!q || r.description.toLowerCase().includes(q) || String(r.material_no).includes(q) || r.category.toLowerCase().includes(q))
  );
  return out.sort((SORTS[f.sort ?? "priority"] ?? SORTS.priority).fn);
}

export function toCsv(recs: Recommendation[]): string {
  const cols: [string, (r: Recommendation) => string | number][] = [
    ["material_no", (r) => r.material_no],
    ["description", (r) => `"${r.description.replace(/"/g, '""')}"`],
    ["criticality", (r) => r.criticality],
    ["action", (r) => r.action],
    ["urgency", (r) => r.urgency ?? ""],
    ["health", (r) => r.health],
    ["safety_critical", (r) => (r.sce ? 1 : 0)],
    ["long_lead", (r) => (r.long_lead ? 1 : 0)],
    ["needs_management_signoff", (r) => (r.requires_approval ? 1 : 0)],
    ["stock", (r) => r.stock],
    ["on_order", (r) => r.on_order],
    ["current_min", (r) => r.current_min],
    ["current_max", (r) => r.current_max],
    ["recommended_safety_stock", (r) => r.safety_stock],
    ["recommended_reorder_point_min", (r) => r.reorder_point],
    ["recommended_max", (r) => r.max_level],
    ["service_level", (r) => r.service_level.toFixed(4)],
    ["order_qty", (r) => r.order_qty],
    ["order_value_idr", (r) => Math.round(r.order_value)],
    ["excess_qty", (r) => r.excess_qty],
    ["excess_value_idr", (r) => Math.round(r.excess_value)],
    ["transfer_qty_from_identical", (r) => r.transfer_qty],
    ["transfer_from", (r) => `"${r.transfer_from.join("; ")}"`],
    ["stockout_risk", (r) => r.stockout_risk.toFixed(4)],
    ["annual_demand", (r) => r.annual_demand.toFixed(2)],
    ["lead_time_days", (r) => r.lead_time_days.toFixed(1)],
    ["unit_price_idr", (r) => Math.round(r.price)],
    ["flags", (r) => `"${r.flags.join("; ")}"`],
  ];
  return [cols.map((c) => c[0]).join(","), ...recs.map((r) => cols.map((c) => c[1](r)).join(","))].join("\n");
}
