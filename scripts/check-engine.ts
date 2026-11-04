// Sanity check of the optimization engine outside Next.js: `npx tsx scripts/check-engine.ts`
import Database from "better-sqlite3";
import { calibrateImpact, recommend, type PlannedEvent } from "../src/lib/engine";
import { DEFAULT_PARAMS } from "../src/lib/params";
import type { MaterialRow } from "../src/lib/types";

const db = new Database("data/caliber.db", { readonly: true });
const asOf = (db.prepare("SELECT value FROM meta WHERE key='as_of'").get() as { value: string }).value;
const mats = db.prepare("SELECT * FROM material").all() as MaterialRow[];
const base = Date.parse(asOf + "T00:00:00Z");
const planned = new Map<number, PlannedEvent[]>();
for (const r of db.prepare("SELECT material_no, due_date, qty FROM planned_demand").all() as { material_no: number; due_date: string; qty: number }[]) {
  const l = planned.get(r.material_no) ?? [];
  l.push({ offset: (Date.parse(r.due_date + "T00:00:00Z") - base) / 864e5, qty: r.qty });
  planned.set(r.material_no, l);
}
const t0 = Date.now();
const em = (db.prepare("SELECT COUNT(*) n FROM notification WHERE priority='Emergency' AND notification_date >= '2025-06-01'").get() as { n: number }).n;
const perYear = (em * 365) / 487;
const scale = calibrateImpact(mats, planned, DEFAULT_PARAMS, perYear);
console.log("emergencies/yr", perYear.toFixed(1), "impact scale", scale.toExponential(3), "P(downtime|stockout) S", (scale).toFixed(4));
const recs = mats.map((m) => recommend(m, planned.get(m.material_no), DEFAULT_PARAMS, asOf, scale));
console.log("computed", recs.length, "in", Date.now() - t0, "ms");
const count = (f: (r: (typeof recs)[0]) => string) => recs.reduce<Record<string, number>>((a, r) => ((a[f(r)] = (a[f(r)] ?? 0) + 1), a), {});
console.log("actions", count((r) => r.action));
console.log("health", count((r) => r.health));
console.log("stocked", count((r) => String(r.stocked)), "urgency", count((r) => String(r.urgency)));
console.log("SL chosen", count((r) => (r.stocked ? r.service_level.toFixed(3) : "none")));
const sum = (f: (r: (typeof recs)[0]) => number) => recs.reduce((a, r) => a + f(r), 0);
const bn = (v: number) => (v / 1e9).toFixed(1) + " bn";
console.log("stock value", bn(sum((r) => r.stock * r.price)), "target avg inv", bn(sum((r) => r.cost.avgInventory * r.price)), "excess", bn(sum((r) => r.excess_value)), "reorder", bn(sum((r) => r.order_value)));
console.log("risk current", bn(sum((r) => r.current_cost.risk)), "risk rec", bn(sum((r) => r.cost.risk)), "stockouts cur/rec", sum((r) => r.current_cost.stockouts).toFixed(0), sum((r) => r.cost.stockouts).toFixed(0));
console.log("downtime events cur/rec", sum((r) => r.current_cost.stockouts * r.downtime_prob).toFixed(1), sum((r) => r.cost.stockouts * r.downtime_prob).toFixed(1), "holding cur/rec", bn(0.2 * sum((r) => r.stock * r.price)), bn(sum((r) => r.cost.holding)));
console.log("reorder by history", count((r) => (r.action === "Reorder" ? (r.flags.includes("Planned demand in lead time") ? "planned" : "hist") : "-")));
console.log("flags", count((r) => r.flags.filter((f) => f.startsWith("Convert")).join("|") || "-"));
for (const id of [4100071636, 4100000129, 4100024158]) {
  const r = recs.find((x) => x.material_no === id)!;
  console.log(id, r.description, { action: r.action, urgency: r.urgency, health: r.health, sl: r.service_level, ss: r.safety_stock, rop: r.reorder_point, max: r.max_level, cur: [r.current_min, r.current_max], stock: r.stock, onOrder: r.on_order, orderQty: r.order_qty, risk: r.stockout_risk.toFixed(2), flags: r.flags });
  console.log("   ", r.reasons.join(" | "));
}
const top = recs.filter((r) => r.action === "Reorder").sort((a, b) => b.priority - a.priority).slice(0, 8);
for (const r of top) console.log("REORDER", r.material_no, r.criticality, r.description.slice(0, 35), "stock", r.stock, "rop", r.reorder_point, "max", r.max_level, "qty", r.order_qty, "risk", r.stockout_risk.toFixed(2), r.urgency);
const red = recs.filter((r) => r.action === "Reduce").sort((a, b) => b.excess_value - a.excess_value).slice(0, 5);
for (const r of red) console.log("REDUCE", r.material_no, r.criticality, r.description.slice(0, 35), "stock", r.stock, "max", r.max_level, "excess", bn(r.excess_value), r.health);
