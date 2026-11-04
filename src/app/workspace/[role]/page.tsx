import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { HBars } from "@/components/charts";
import { ReplayCard } from "@/components/ReplayCard";
import { Card, Chip, CritChip, MaterialLink, Note, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { DecisionList, ImpactPanel, PrQueue, type DecisionRow } from "@/components/workspace";
import { asOf, getMaterial, getMeta, getRecommendations, mlCalibration, mlMetrics, portfolio } from "@/lib/data";
import { ML_WARNING } from "@/lib/engine";
import { date, idr, num, pct, qty } from "@/lib/format";
import { replay } from "@/lib/replay";
import { roleById, type Role } from "@/lib/roles";
import { currentParams } from "@/lib/server-params";
import { CRIT_RANK, isCritical, type Params } from "@/lib/types";
import { departmentSummary, expediteList, insuranceGaps, jobReadiness, mlWarnings, supplierRisk, supplierStats, tamReadiness } from "@/lib/workflow";

export const dynamic = "force-dynamic";
const CAP = 400; // longest worklist sent to the browser; the full list stays in Recommendations

function Header({ role }: { role: Role }) {
  return (
    <PageHeader title={role.name} subtitle={role.question} crumbs={[{ label: "Workspaces" }, { label: role.name }]}>
      <div className="flex flex-col items-end gap-1 text-[11.5px] text-ink-2">
        <span><span className="text-muted">User role:</span> {role.who}</span>
        <span><span className="text-muted">Input:</span> {role.receives} · <span className="text-muted">Output:</span> {role.hands_off}</span>
      </div>
    </PageHeader>
  );
}

function Step({ n, title, subtitle, children, aside }: { n: number; title: string; subtitle: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <Card
      className="mt-4"
      title={`${n}. ${title}`}
      subtitle={subtitle}
      action={aside}
    >
      {children}
    </Card>
  );
}

const nextLink = (href: string, label: string) => (
  <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
    {label} <ArrowRight size={13} aria-hidden />
  </Link>
);

// ------------------------------------------------------------------ planner

function Planner({ p }: { p: Params }) {
  const recs = getRecommendations(p);
  const reorders = recs.filter((r) => r.action === "Reorder").sort((a, b) => b.priority - a.priority);
  const transfers = recs.filter((r) => r.transfer_qty > 0).sort((a, b) => b.priority - a.priority);
  const big = (a: number, b: number) => Math.abs(a - b) > Math.max(2, 0.3 * Math.max(a, b));
  const params = recs
    .filter((r) => r.stocked !== (r.mrp_type === "Stock Item") || (r.stocked && (big(r.reorder_point, r.current_min) || big(r.max_level, r.current_max))))
    .sort((a, b) => CRIT_RANK[b.criticality] - CRIT_RANK[a.criticality] || b.priority - a.priority);
  const reduces = recs.filter((r) => r.action === "Reduce").sort((a, b) => b.excess_value - a.excess_value);

  const transferRows: DecisionRow[] = transfers.map((r) => ({
    material_no: r.material_no, description: r.description, crit: r.criticality, qty: r.transfer_qty,
    badge: r.action === "Transfer" ? "No purchase needed" : `then buy ${qty(r.order_qty)}`,
    cells: [qty(r.stock), r.transfer_from.join(", "), qty(r.reorder_point), pct(r.stockout_risk), idr(r.transfer_qty * r.price)],
  }));
  const reorderRows: DecisionRow[] = reorders.slice(0, CAP).map((r) => ({
    material_no: r.material_no, description: r.description, crit: r.criticality, qty: r.order_qty,
    badge: r.urgency === "Critical" ? "Critical" : r.ml_warning ? "ML warning" : undefined,
    cells: [qty(r.stock), qty(r.on_order), qty(r.reorder_point), pct(r.stockout_risk), idr(r.order_value)],
  }));
  const paramRows: DecisionRow[] = params.slice(0, CAP).map((r) => ({
    material_no: r.material_no, description: r.description, crit: r.criticality,
    badge: r.flags.find((f) => f.startsWith("Convert"))?.replace("Convert to ", "→ "),
    cells: [`${qty(r.current_min)} / ${qty(r.current_max)}`, r.stocked ? `${qty(r.reorder_point)} / ${qty(r.max_level)}` : "0 / 0", r.stocked ? qty(r.safety_stock) : "–", r.stocked ? pct(r.service_level, 1) : "buy on demand"],
  }));
  const reduceRows: DecisionRow[] = reduces.slice(0, CAP).map((r) => ({
    material_no: r.material_no, description: r.description, crit: r.criticality, badge: r.health,
    cells: [qty(r.stock), r.stocked ? qty(r.max_level) : "0", qty(r.excess_qty), idr(r.excess_value)],
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Covered by identical stock" value={num(transfers.length)} hint={`${idr(transfers.reduce((a, r) => a + r.transfer_qty * r.price, 0))} not bought · same part held under another number`} tone="good" />
        <Stat label="Reorders to review" value={num(reorders.length)} hint={`${num(reorders.filter((r) => r.urgency === "Critical").length)} critical · ${idr(reorders.reduce((a, r) => a + r.order_value, 0))}`} tone="critical" />
        <Stat label="Min–Max settings to update" value={num(params.length)} hint="Recommended level differs >30% from today, or the MRP type should change" />
        <Stat label="Excess positions" value={num(reduces.length)} hint={`${idr(reduces.reduce((a, r) => a + r.excess_value, 0))} · planning date ${date(asOf())}`} />
      </div>
      <Step n={1} title="Use identical stock before buying" subtitle="The part is needed, but the same item (identical description and unit) is held under another material number above that number's own reorder point. Transfer or substitute instead of buying.">
        <DecisionList kind="transfer" role="planner" rows={transferRows} columns={["On hand", "Transfer from", "Rec. Min", "Stockout risk", "Purchase avoided"]} qtyLabel="Transfer qty" approveLabel="Transfer" empty="No need can be covered by identical stock." />
      </Step>
      <Step n={2} title="Approve reorders" subtitle="Inventory position (on hand + on order) at or below the dynamic reorder point. Quantities already exclude identical stock. Approved lines go to Procurement." aside={nextLink("/workspace/procurement", "Procurement queue")}>
        <DecisionList kind="reorder" role="planner" source="Planner reorder" rows={reorderRows} columns={["On hand", "On order", "Rec. Min", "Stockout risk", "Value"]} qtyLabel="Order qty" approveLabel="Approve" />
        {reorders.length > CAP && <Note>Top {CAP} of {num(reorders.length)} by priority; the full list is in Recommendations.</Note>}
      </Step>
      <Step n={3} title="Approve dynamic Min–Max updates" subtitle="Replace static parameters with the recommended reorder point (Min) and Max. Approved changes download as a list for the ERP (e.g. SAP MM02).">
        <DecisionList kind="param" role="planner" rows={paramRows} columns={["Today Min / Max", "Rec. Min / Max", "Safety stock", "Service level"]} approveLabel="Approve" exportName="min-max-updates.csv" />
      </Step>
      <Step n={4} title="Approve excess reductions" subtitle="Stop replenishing and run down, return or transfer stock above the recommended maximum. Released value is reported to Management." aside={nextLink("/workspace/management", "Management impact")}>
        <DecisionList kind="reduce" role="planner" rows={reduceRows} columns={["On hand", "Rec. Max", "Excess qty", "Excess value"]} approveLabel="Reduce" exportName="excess-reductions.csv" />
      </Step>
    </>
  );
}

// ------------------------------------------------------------------ maintenance

function TurnaroundReadiness({ p, date: tamDate }: { p: Params; date: string }) {
  const meta = getMeta();
  const t = tamReadiness(p, tamDate);
  const rows: DecisionRow[] = t.lines
    .filter((l) => l.shortfall > 0)
    .map((l) => ({
      material_no: l.material_no, description: l.description, crit: l.criticality, qty: l.shortfall, need_by: tamDate, badge: l.status,
      cells: [`${qty(l.need)} ${l.unit}`, qty(l.available), qty(l.shortfall), date(l.order_by), idr(l.shortfall_value)],
    }));
  return (
    <Step
      n={2}
      title="Next turnaround readiness"
      subtitle={`Assumes the next turnaround repeats the scope of the last one, detected in the data as ${date(meta.tam_start)} – ${date(meta.tam_end)} (${num(Number(meta.tam_parts))} parts, ${num(Number(meta.tam_units))} units on turnaround orders; ${pct(Number(meta.tam_window_share))} of all units issued in 17 months). Stock on the day = on hand + open POs arriving before it + identical stock − expected routine and planned use until then. Order-by = start date − the lead time 80% of past deliveries met.`}
    >
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">Planned start of the next turnaround (planner input)<br />
          <input type="date" name="tam" defaultValue={tamDate} min={asOf()} className="input" />
        </label>
        <button className="btn btn-primary">Check readiness</button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Turnaround readiness" value={pct(t.readiness)} hint={`${num(t.ready)} of ${num(t.parts)} parts covered on ${date(tamDate)}`} tone={t.readiness >= 0.9 ? "good" : "critical"} />
        <Stat label="Parts short" value={num(t.parts - t.ready)} hint={`${num(t.criticalShort)} critical (A/B)`} />
        <Stat label="Too late to order normally" value={num(t.late)} hint="Order-by date already passed: expedite or re-plan" tone={t.late ? "critical" : "good"} />
        <Stat label="Value to buy" value={idr(t.shortValue)} hint="Shortfall × unit price" />
      </div>
      <DecisionList kind="tam" role="maintenance" source="Turnaround" rows={rows} columns={["Last TAM used", "Available on the day", "Short", "Order by", "Value"]} qtyLabel="Request qty" approveLabel="Request" empty="Every part of the last turnaround's scope is covered on that date." />
    </Step>
  );
}

function Maintenance({ p, tam }: { p: Params; tam: string }) {
  const jobs = jobReadiness(90);
  const short = jobs.filter((j) => j.status === "Short");
  const byMat = new Map<number, { need: number; short: number; first: string; jobs: number; desc: string; unit: string }>();
  for (const j of jobs)
    for (const x of j.parts) {
      if (x.shortfall <= 0) continue;
      const a = byMat.get(x.material_no) ?? { need: 0, short: 0, first: j.due_date, jobs: 0, desc: x.description, unit: x.unit };
      a.need += x.need;
      a.short += x.shortfall;
      a.jobs++;
      if (j.due_date < a.first) a.first = j.due_date;
      byMat.set(x.material_no, a);
    }
  const requestRows: DecisionRow[] = [...byMat.entries()]
    .sort((a, b) => a[1].first.localeCompare(b[1].first))
    .map(([id, a]) => ({
      material_no: id, description: a.desc, crit: getMaterial(id)?.criticality ?? "C", qty: a.short, need_by: a.first,
      cells: [`${qty(a.need)} ${a.unit}`, qty(a.short), date(a.first), num(a.jobs)],
    }));
  const warn = mlWarnings(p).filter((r) => !byMat.has(r.material_no));
  const warnRows: DecisionRow[] = warn.slice(0, CAP).map((r) => {
    const m = getMaterial(r.material_no)!;
    return {
      material_no: r.material_no, description: r.description, crit: r.criticality, qty: Math.max(1, Math.ceil(m.size_mean)),
      cells: [pct(r.p_demand_90d), qty(m.size_mean), `${Math.round(r.lead_time_days)} d`, m.last_issue ? date(m.last_issue) : "never"],
    };
  });
  const gaps = insuranceGaps(p);
  const gapsCritical = gaps.filter((r) => isCritical(r.criticality)).length;
  // hit rate of the early-warning threshold, read from the stored hold-out calibration
  const calib = mlCalibration();
  const above = calib.filter((c) => Number(c.bin.match(/[\d.]+/)?.[0] ?? 0) >= ML_WARNING - 1e-9);
  const mlHit = above.length ? pct(above.reduce((a, c) => a + c.observed * c.parts, 0) / above.reduce((a, c) => a + c.parts, 0)) : "–";
  const mlBase = mlMetrics().find((m) => m.model.startsWith("ML"))?.base_rate ?? 0;
  // abnormal consumption lives on the Demand Forecast page: it is a forecasting concern, not a daily maintenance task
  // an insurance spare protects against the first failure: keep the reorder-point level, not a full order cycle
  const gapRows: DecisionRow[] = gaps.slice(0, CAP).map((r) => ({
    material_no: r.material_no, description: r.description, crit: r.criticality, qty: Math.max(1, r.reorder_point),
    cells: [num(getMaterial(r.material_no)?.n_funcloc_critical ?? 0), qty(r.annual_demand), `${Math.round(r.lead_time_days)} d`, idr(r.price)],
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Part-consuming jobs, next 90 days" value={num(jobs.length)} hint={`${num(jobs.filter((j) => j.status === "Ready").length)} ready · ${num(jobs.filter((j) => j.status === "Covered by open PO").length)} covered by open PO`} />
        <Stat label="Jobs with missing parts" value={num(short.length)} hint={`${num(byMat.size)} parts short`} tone={short.length ? "critical" : "good"} />
        <Stat label="ML early warnings" value={num(warn.length)} hint="Likely needed within 90 days, no stock and no PO" />
        <Stat label="Unprotected never-used parts" value={num(gaps.length)} hint={`${num(gapsCritical)} of them criticality A/B · no stock, insurance review`} />
      </div>

      <Step n={1} title="Job readiness — next 90 days" subtitle="Stock is allocated to jobs in due-date order; an open PO counts only if it arrives before the job. Parts per job come from the BoM of the job's FuncLoc.">
        <Table>
          <thead><tr><Th>Due</Th><Th>Equipment</Th><Th>Job</Th><Th>Parts</Th><Th>Status</Th></tr></thead>
          <tbody>
            {[...short, ...jobs.filter((j) => j.status !== "Short")].slice(0, 12).map((j) => (
              <tr key={j.key}>
                <Td className="whitespace-nowrap">{date(j.due_date)}</Td>
                <Td>{j.funcloc}<div className="text-xs text-muted">{j.fl_description} · crit. {j.criticality}</div></Td>
                <Td>{j.task}</Td>
                <Td className="text-xs">
                  {j.parts.slice(0, 3).map((x) => (
                    <div key={x.material_no}><MaterialLink id={x.material_no} /> need {qty(x.need)}{x.shortfall > 0 && <span className="text-critical-ink"> · short {qty(x.shortfall)}</span>}</div>
                  ))}
                  {j.parts.length > 3 && <div className="text-muted">+{j.parts.length - 3} more</div>}
                </Td>
                <Td><Chip tone={j.status === "Short" ? "critical" : j.status === "Ready" ? "good" : "warning"}>{j.status}</Chip></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <h3 className="mb-2 mt-5 text-sm font-semibold">Request the missing parts</h3>
        <DecisionList kind="request" role="maintenance" source="Maintenance job" rows={requestRows} columns={["Needed for jobs", "Short", "First job due", "Jobs"]} qtyLabel="Request qty" approveLabel="Request" empty="Every job in the next 90 days is covered." />
      </Step>

      <TurnaroundReadiness p={p} date={tam} />

      <Step n={3} title="ML early warnings" subtitle={`Gradient-boosting model: probability that the part is needed in the next 90 days. Shown when ≥ 30% and nothing is on hand or on order (on the hold-out, parts scored ≥ 30% were needed ${mlHit} of the time vs ${pct(mlBase, 1)} on average).`} aside={nextLink("/forecast#ml", "How the model works")}>
        <DecisionList kind="request" role="maintenance" source="ML early warning" rows={warnRows} columns={["P(needed, 90 d)", "Typical issue", "Lead time", "Last issued"]} qtyLabel="Request qty" approveLabel="Request" empty="No early warnings without cover." />
      </Step>

      <Step n={4} title="Insurance spare review" subtitle="Parts never issued in 17 months and not in stock, critical (A/B) first. Their demand comes from the failure rate of the equipment they sit on; the cost model says holding the reorder-point level is cheaper than the downtime risk. Confirm before buying.">
        <DecisionList kind="insurance" role="maintenance" source="Insurance spare" rows={gapRows} columns={["Critical FuncLocs", "Expected demand / yr", "Lead time", "Unit price"]} qtyLabel="Keep qty" approveLabel="Keep" empty="No unprotected critical parts." />
      </Step>

    </>
  );
}

// ------------------------------------------------------------------ procurement

function Procurement({ p }: { p: Params }) {
  const expedite = expediteList(p);
  const stats = supplierStats();
  const worst = supplierRisk(1)[0];
  const recs = getRecommendations(p);
  const singleCrit = recs.filter((r) => (isCritical(r.criticality)) && r.flags.includes("Single source")).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Open POs to expedite" value={num(expedite.length)} hint="Reorder parts whose stock will not last until the open PO arrives" tone={expedite.length ? "critical" : "good"} />
        <Stat label="Critical parts with a single supplier" value={num(singleCrit)} hint={worst ? `Most exposed: ${worst.supplier_name} (${num(worst.single_source_critical)} critical parts, ${pct(worst.on_time_rate)} on time)` : "Every part in PR PO history has exactly one supplier"} />
        <Stat label="Suppliers in PR PO history" value={num(stats.suppliers)} hint={`Median on-time rate ${pct(stats.onTimeMedian)} (PO delivery date on or before the requested date)`} />
      </div>
      <Step n={1} title="Purchase requisition draft" subtitle="Approved buys from the Planner and Maintenance workspaces. PR type, purchasing group and supplier come from each part's own PR PO history; need-by date from the job or the lead time.">
        <PrQueue />
      </Step>
      <Step n={2} title="Expedite open POs" subtitle="Stock on hand is below expected demand during the lead time, and an open PO is the only cover.">
        <Table>
          <thead><tr><Th>Part</Th><Th>Crit.</Th><Th right>On hand</Th><Th right>Demand in lead time</Th><Th right>On order</Th><Th>Next delivery</Th><Th right>Stockout risk</Th></tr></thead>
          <tbody>{expedite.slice(0, 15).map((r) => (
            <tr key={r.material_no}><Td><MaterialLink id={r.material_no} /><div className="text-xs text-muted">{r.description.slice(0, 44)}</div></Td><Td><CritChip crit={r.criticality} /></Td><Td right>{qty(r.stock)}</Td><Td right>{qty(r.lt_demand)}</Td><Td right>{qty(r.on_order)}</Td><Td>{date(r.next_delivery)}</Td><Td right>{pct(r.stockout_risk)}</Td></tr>
          ))}</tbody>
        </Table>
      </Step>
    </>
  );
}

// ------------------------------------------------------------------ management

function Management({ p }: { p: Params }) {
  const pf = portfolio(p);
  const r = replay(p);
  const depts = departmentSummary(p);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Inventory value (PO prices)" value={idr(pf.currentStockValuePo)} hint={`${idr(pf.currentStockValue)} incl. parts never purchased in the data, valued at category-median prices`} />
        <Stat label="Excess above the recommended maximum" value={idr(pf.excessValuePo)} hint={`At PO prices · ${num(pf.actions.Reduce)} parts to reduce`} tone="good" />
        <Stat label="Reorder now" value={num(pf.actions.Reorder)} hint={`${num(pf.urgentCritical)} critical · ${idr(pf.reorderValue)}`} tone="critical" />
        <Stat label="Covered by identical stock" value={num(pf.transfer.parts)} hint={`${idr(pf.transfer.valueAvoided)} not bought: same item under another material number`} tone="good" />
      </div>
      <Step n={1} title="Impact of the team's decisions" subtitle="Live total of everything approved in the Planner, Maintenance and Procurement workspaces (this browser).">
        <ImpactPanel />
      </Step>
      <div className="mt-4">
        <ReplayCard r={r} />
      </div>
      <Step n={2} title="Inventory health" subtitle="Number of spare parts in each status" aside={nextLink("/health", "Inventory Health")}>
        <HBars data={pf.health.map((h) => ({ label: h.status, value: h.count }))} />
      </Step>
      <Step n={3} title="By owning department (Purchasing Group)" subtitle="Purchasing Group = the department that owns the part (confirmed by the organizers). Taken from each part's own PO history; parts never purchased take their category's dominant group.">
        <Table>
          <thead><tr><Th>Department</Th><Th right>Parts</Th><Th right>From PO history</Th><Th right>Reorders</Th><Th right>Reorder value</Th><Th right>Excess to release</Th><Th right>Transfers</Th></tr></thead>
          <tbody>
            {depts.slice(0, 10).map((d) => (
              <tr key={d.group}><Td className="font-medium">{d.group}</Td><Td right>{num(d.parts)}</Td><Td right>{num(d.fromPo)}</Td><Td right>{num(d.reorders)}</Td><Td right>{idr(d.reorderValue)}</Td><Td right>{idr(d.excessValue)}</Td><Td right>{num(d.transfers)}</Td></tr>
            ))}
          </tbody>
        </Table>
        <Note>{num(depts.reduce((a, d) => a + d.fromPo, 0))} of {num(pf.materials)} parts have an owning department from PO history; the rest are inferred from their category. Excess values include category-estimated prices.</Note>
      </Step>
      <Step n={4} title="Where the actions are" subtitle="Open work per workspace" aside={nextLink("/scenario", "Change the cost–risk policy")}>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { href: "/workspace/planner", t: "Inventory Planner", v: `${num(pf.actions.Transfer + pf.transfer.partialReorders)} transfers · ${num(pf.actions.Reorder)} reorders · ${num(pf.actions.Reduce)} reductions` },
            { href: "/workspace/maintenance", t: "Maintenance & Reliability", v: "Job readiness, early warnings, insurance spares" },
            { href: "/workspace/procurement", t: "Procurement", v: "PR draft, expediting" },
          ].map((x) => (
            <Link key={x.href} href={x.href} className="rounded-lg border border-line p-3 hover:bg-surface-2">
              <div className="text-sm font-semibold">{x.t}</div>
              <div className="text-xs text-muted">{x.v}</div>
            </Link>
          ))}
        </div>
      </Step>
    </>
  );
}

const addDays = (iso: string, d: number) => new Date(Date.parse(iso + "T00:00:00Z") + d * 86_400_000).toISOString().slice(0, 10);

export default async function Workspace({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  // next turnaround start is a planner input; until one is given, check six months ahead
  const tam = sp.tam && /^\d{4}-\d{2}-\d{2}$/.test(sp.tam) && sp.tam > asOf() ? sp.tam : addDays(asOf(), 182);
  const { role: id } = await params;
  const role = roleById(id);
  if (!role) notFound();
  const p = await currentParams();
  return (
    <>
      <Header role={role} />
      {role.id === "planner" && <Planner p={p} />}
      {role.id === "maintenance" && <Maintenance p={p} tam={tam} />}
      {role.id === "procurement" && <Procurement p={p} />}
      {role.id === "management" && <Management p={p} />}
    </>
  );
}
