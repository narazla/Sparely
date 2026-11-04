import "server-only";
/**
 * Warehouse replay: run the actual issues of the hold-out window (May–Sep 2026)
 * through two warehouses, day by day — one controlled by today's static Min–Max,
 * one by the Sparely policy computed from data before the window only.
 *
 * Rules (identical for both warehouses):
 *  - each warehouse starts at its own policy's Max (0 for parts it does not stock),
 *  - every day: receive arrivals, serve the day's actual issues from stock (any
 *    shortfall is a stockout, bought outside the warehouse), then review: when
 *    on hand + on order <= Min, order up to Max,
 *  - an order arrives after the part's lead time (same for both warehouses).
 */
import { all, one } from "./db";
import { calibrateImpact, choosePolicy, context, type PlannedEvent } from "./engine";
import { DEFAULT_PARAMS } from "./params";
import { SCE_FUNCLOC_SQL } from "./rules";
import { CRITS, isCritical, type Crit, type MaterialRow, type Params } from "./types";

interface ReplayRow {
  material_no: number;
  description: string;
  unit: string;
  mrp_type: "Stock Item" | "Non Stock";
  min_qty: number;
  max_qty: number;
  criticality: Crit;
  lt_mean: number;
  lt_std: number;
  lt_fast: number;
  price_idr: number;
  occ_rate: number;
  size_mean: number;
  size_var: number;
  mu_day: number;
  var_day: number;
  planned_qty_12m: number;
  n_funcloc_sce: number;
}

export interface PolicyResult {
  demandDays: number;
  servedDays: number;
  demandUnits: number;
  servedUnits: number;
  stockouts: number;
  criticalStockouts: number;
  partsWithStockout: number;
  avgInventoryValue: number;
  endInventoryValue: number;
  orders: number;
  orderValue: number;
}

export interface ReplayResult {
  start: string;
  end: string;
  days: number;
  staticPolicy: PolicyResult;
  aiPolicy: PolicyResult;
  byCriticality: { crit: Crit; demandDays: number; staticStockouts: number; aiStockouts: number }[];
  daily: { day: string; staticValue: number; aiValue: number }[];
  examples: { material_no: number; description: string; crit: Crit; demandDays: number; staticStockouts: number; aiStockouts: number }[];
  worse: number;
  better: number;
}

let data: { rows: ReplayRow[]; planned: Map<number, PlannedEvent[]>; demand: Map<number, [number, number][]>; meta: Record<string, string> } | null = null;

function load() {
  if (!data) {
    const meta = Object.fromEntries(all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'replay%'").map((r) => [r.key, r.value]));
    const planned = new Map<number, PlannedEvent[]>();
    for (const r of all<{ material_no: number; offset: number; qty: number }>("SELECT material_no, offset, qty FROM replay_planned ORDER BY offset")) {
      const l = planned.get(r.material_no) ?? [];
      l.push({ offset: r.offset, qty: r.qty });
      planned.set(r.material_no, l);
    }
    const demand = new Map<number, [number, number][]>();
    for (const r of all<{ material_no: number; day: number; qty: number }>("SELECT material_no, day, qty FROM replay_demand ORDER BY day")) {
      const l = demand.get(r.material_no) ?? [];
      l.push([r.day, r.qty]);
      demand.set(r.material_no, l);
    }
    // the safety-critical rule follows the installed equipment, which does not change over time
    const rows = all<ReplayRow>(
      `SELECT r.*, COALESCE(s.n, 0) n_funcloc_sce FROM replay_material r
       LEFT JOIN (SELECT material_no, COUNT(DISTINCT funcloc) n FROM material_funcloc WHERE ${SCE_FUNCLOC_SQL} GROUP BY 1) s USING (material_no)`
    );
    data = { rows, planned, demand, meta };
  }
  return data;
}

function simulate(days: number, demand: [number, number][] | undefined, stocked: boolean, rop: number, max: number, lead: number, price: number, inv: Float64Array) {
  let onHand = stocked ? max : 0;
  const arrivals = new Map<number, number>();
  let onOrder = 0;
  let di = 0;
  const r = { demandDays: 0, servedDays: 0, demandUnits: 0, servedUnits: 0, stockouts: 0, orders: 0, orderValue: 0, invSum: 0, end: 0 };
  for (let d = 0; d < days; d++) {
    const a = arrivals.get(d);
    if (a) {
      onHand += a;
      onOrder -= a;
    }
    if (demand && di < demand.length && demand[di][0] === d) {
      const q = demand[di][1];
      di++;
      const served = Math.min(onHand, q);
      onHand -= served;
      r.demandDays++;
      r.demandUnits += q;
      r.servedUnits += served;
      if (served >= q) r.servedDays++;
      else r.stockouts++;
    }
    if (stocked && onHand + onOrder <= rop) {
      const q = Math.max(1, Math.ceil(max - onHand - onOrder));
      const at = d + lead;
      arrivals.set(at, (arrivals.get(at) ?? 0) + q);
      onOrder += q;
      r.orders++;
      r.orderValue += q * price;
    }
    const v = onHand * price;
    r.invSum += v;
    inv[d] += v;
  }
  r.end = onHand * price;
  return r;
}

const cache = new Map<string, ReplayResult>();

export function replay(p: Params): ReplayResult {
  const key = JSON.stringify(p);
  const hit = cache.get(key);
  if (hit) return hit;
  const { rows, planned, demand, meta } = load();
  const days = Number(meta.replay_days);
  // downtime probability calibrated the same way as the live engine, but on training-period emergencies only
  const scale = calibrateImpact(rows as unknown as MaterialRow[], planned, DEFAULT_PARAMS, Number(meta.replay_emergencies_per_year));
  const invS = new Float64Array(days);
  const invA = new Float64Array(days);
  const blank = (): PolicyResult => ({ demandDays: 0, servedDays: 0, demandUnits: 0, servedUnits: 0, stockouts: 0, criticalStockouts: 0, partsWithStockout: 0, avgInventoryValue: 0, endInventoryValue: 0, orders: 0, orderValue: 0 });
  const S = blank();
  const A = blank();
  const crit = new Map<Crit, { demandDays: number; staticStockouts: number; aiStockouts: number }>();
  const examples: ReplayResult["examples"] = [];
  let worse = 0;
  let better = 0;

  for (const raw of rows) {
    const m = { ...raw, n_events: 0 } as unknown as MaterialRow;
    const c = context(m, planned.get(raw.material_no), p, scale);
    const pol = choosePolicy(c, m, p);
    const lead = Math.max(1, Math.round(c.L));
    const dem = demand.get(raw.material_no);
    const staticStocked = raw.mrp_type === "Stock Item" && raw.max_qty > 0;
    const s = simulate(days, dem, staticStocked, raw.min_qty, raw.max_qty, lead, c.price, invS);
    const a = simulate(days, dem, pol.stocked, pol.rop, pol.max, lead, c.price, invA);
    const isCrit = isCritical(raw.criticality);
    for (const [T, x] of [[S, s], [A, a]] as const) {
      T.demandDays += x.demandDays;
      T.servedDays += x.servedDays;
      T.demandUnits += x.demandUnits;
      T.servedUnits += x.servedUnits;
      T.stockouts += x.stockouts;
      if (isCrit) T.criticalStockouts += x.stockouts;
      if (x.stockouts > 0) T.partsWithStockout++;
      T.avgInventoryValue += x.invSum / days;
      T.endInventoryValue += x.end;
      T.orders += x.orders;
      T.orderValue += x.orderValue;
    }
    if (s.demandDays > 0) {
      const k = crit.get(raw.criticality) ?? { demandDays: 0, staticStockouts: 0, aiStockouts: 0 };
      k.demandDays += s.demandDays;
      k.staticStockouts += s.stockouts;
      k.aiStockouts += a.stockouts;
      crit.set(raw.criticality, k);
      if (a.stockouts < s.stockouts) better++;
      if (a.stockouts > s.stockouts) worse++;
      examples.push({ material_no: raw.material_no, description: raw.description, crit: raw.criticality, demandDays: s.demandDays, staticStockouts: s.stockouts, aiStockouts: a.stockouts });
    }
  }

  const start = meta.replay_start;
  const day0 = Date.parse(start + "T00:00:00Z");
  const daily = Array.from({ length: days }, (_, d) => ({
    day: new Date(day0 + d * 86_400_000).toISOString().slice(0, 10),
    staticValue: invS[d],
    aiValue: invA[d],
  })).filter((_, d) => d % 3 === 0 || d === days - 1);

  const result: ReplayResult = {
    start,
    end: meta.replay_end,
    days,
    staticPolicy: S,
    aiPolicy: A,
    byCriticality: CRITS.map((k) => ({ crit: k, ...(crit.get(k) ?? { demandDays: 0, staticStockouts: 0, aiStockouts: 0 }) })),
    daily,
    examples: examples
      .filter((e) => e.staticStockouts > e.aiStockouts)
      .sort((x, y) => (y.staticStockouts - y.aiStockouts) - (x.staticStockouts - x.aiStockouts) || (y.crit < x.crit ? -1 : 1))
      .slice(0, 8),
    worse,
    better,
  };
  if (cache.size > 8) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}

export const replayEmergencies = () => Number(one<{ value: string }>("SELECT value FROM meta WHERE key = 'replay_emergencies_per_year'")?.value ?? 0);
