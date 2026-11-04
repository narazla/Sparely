import Link from "next/link";
import { ArrowRight, BrainCircuit, ClipboardCheck, Database, Factory, ShieldCheck, ShoppingBag, Wrench } from "lucide-react";
import { Card, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { DecisionSummary } from "@/components/workspace";
import { backtest, dataQuality, getImpact, getMeta, mlMetrics, portfolio } from "@/lib/data";
import { idr, num, pct } from "@/lib/format";
import { ROLES } from "@/lib/roles";
import { replay } from "@/lib/replay";
import { currentParams } from "@/lib/server-params";
import { expediteList, jobReadiness } from "@/lib/workflow";

export const dynamic = "force-dynamic";

export default async function Start() {
  const meta = getMeta();
  const p = await currentParams();
  const pf = portfolio(p);
  const ml = mlMetrics().find((m) => m.model.startsWith("ML"));
  const bt = backtest();
  const ours = bt.find((b) => b.method.startsWith("CALIBER"));
  const stat = bt.find((b) => b.method.startsWith("Static"));
  const impact = getImpact();
  const checks = dataQuality().length;
  const rp = replay(p);
  const S = rp.staticPolicy;
  const A = rp.aiPolicy;

  const flow = [
    { icon: Database, t: "1 · Baseline data", d: `6 files: ${num(Number(meta.materials))} parts, ${num(Number(meta.funclocs))} FuncLocs, ${num(Number(meta.movements))} issues, ${num(Number(meta.notifications))} notifications, ${num(Number(meta.mplan_items))} plan items, ${num(Number(meta.po_lines))} PO lines` },
    { icon: ShieldCheck, t: "2 · Clean & link", d: `${checks} data-quality checks (duplicates, units, currencies, cycles); parts linked to equipment, failures, purchases and the maintenance plan` },
    { icon: BrainCircuit, t: "3 · Forecast & optimize", d: `Hybrid demand forecast (bias ${pct(ours?.bias ?? 0)} vs ${pct(stat?.bias ?? 0)} static), ML early warning (AUC ${(ml?.auc ?? 0).toFixed(2)}), cost–risk optimizer calibrated to ${num(impact.emergenciesPerYear, 0)} emergencies / yr` },
    { icon: ClipboardCheck, t: "4 · Role workspaces", d: "Maintenance requests job parts; the Planner uses identical stock first, then approves reorders and Min–Max; Procurement gets a PR draft" },
    { icon: Factory, t: "5 · Proven impact", d: `Replaying May–Sep 2026: stockouts ${num(S.stockouts)} → ${num(A.stockouts)}, demand days served ${pct(S.servedDays / S.demandDays)} → ${pct(A.servedDays / A.demandDays)}, inventory held ${pct(A.avgInventoryValue / S.avgInventoryValue - 1)}` },
  ];

  const brief: [string, string, string, string][] = [
    ["Demand forecasting (history, failures, maintenance, shutdowns, installed base, abnormal use)", "/forecast", "Demand Forecast", `${num(Number(meta.planned_events_12m))} planned part lines in 12 months; turnaround split out; abnormal issues capped`],
    ["Dynamic Min–Max, safety stock, reorder point, replenishment qty", "/workspace/planner", "Planner workspace", `${num(pf.actions.Reorder)} reorders; Min–Max recomputed per part on every request`],
    ["Inventory health: excess, slow-moving, non-moving, potentially obsolete", "/health", "Inventory Health", `${num(pf.health.find((h) => h.status === "Non-moving")?.count ?? 0)} non-moving · ${num(pf.health.find((h) => h.status === "Potentially obsolete")?.count ?? 0)} potentially obsolete`],
    ["Reorder / maintain / reduce / monitor, balancing cost vs stockout & downtime risk", "/recommendations", "Material List", `${num(pf.actions.Reorder)} reorder · ${num(pf.actions.Reduce)} reduce · ${num(pf.actions.Monitor)} monitor · ${num(pf.actions.Maintain)} maintain`],
    ["Stockout risk & overstock risk", "/recommendations?sort=risk", "Material List", `${num(pf.criticalAtRisk)} critical parts ≥ 50% stockout risk · excess ${idr(pf.excessValuePo)} at PO prices`],
    ["Slow-moving alert", "/health", "Inventory Health", `${num(pf.health.find((h) => h.status === "Slow-moving")?.count ?? 0)} parts not issued for > 180 days`],
    ["Cost–risk optimization scenarios (raise / lower inventory)", "/scenario", "Cost–Risk Scenarios", "Presets + live re-optimization of all parts + efficient frontier + replay under the scenario"],
    ["Shutdown and turnaround activities", "/workspace/maintenance", "Maintenance", `Last turnaround found in the data (${num(Number(meta.tam_parts))} parts); readiness for the next one with order-by dates`],
    ["Right part available at the right time (the core problem)", "/health", "Inventory Health", `${num(pf.transfer.parts)} needs covered by the same item held under another material number · ${idr(pf.transfer.valueAvoided)} not bought`],
    ["Equipment and spare part criticality, incl. process safety", "/recommendations?tag=sce", "Material List", `${num(pf.governance.sce)} safety-critical parts (safety and shutdown valves) costed as class A and never left without a spare · ${num(pf.governance.longLead)} long-lead critical parts flagged`],
    ["Governed decisions", "/workspace/management", "Management", `${num(pf.governance.signoffBuys)} buys and ${num(pf.governance.signoffReductions)} reductions need Management sign-off; every decision is logged`],
    ["Evidence that the policy works", "/workspace/management", "Management", `Replay of ${num(S.demandDays)} real demand days: ${num(S.criticalStockouts)} → ${num(A.criticalStockouts)} stockouts on critical parts`],
    ["Key Q1 — predictability of irregular demand", "/forecast", "Demand Forecast", "Demand split by cause, installed-base pooling, ML early warning, out-of-time backtests"],
    ["Key Q2 — balance inventory cost, availability, operational risk", "/scenario", "Cost–Risk Scenarios", "Per-part service level chosen by minimum holding + downtime-risk cost"],
  ];

  const jobsShort = jobReadiness(90).filter((j) => j.status === "Short").length;
  const expedite = expediteList(p).length;
  const tiles = [
    { id: "maintenance", icon: Wrench, value: num(jobsShort), label: "jobs in the next 90 days with missing parts" },
    { id: "planner", icon: ClipboardCheck, value: num(pf.actions.Reorder + pf.actions.Transfer), label: `reorders and transfers to review (${num(pf.urgentCritical)} critical reorders)` },
    { id: "procurement", icon: ShoppingBag, value: num(expedite), label: "open POs to expedite" },
    { id: "management", icon: Factory, value: idr(pf.excessValuePo), label: "excess stock to release (PO prices)" },
  ] as const;

  return (
    <>
      <PageHeader title="Spare Parts Planning — Overview" subtitle="Most tools forecast what you used. Sparely prepares you for what's coming — and proves it." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Reorder now" value={num(pf.actions.Reorder)} hint={`${num(pf.urgentCritical)} critical (A/B or SCE) · ${idr(pf.reorderValue)}`} tone="critical" />
        <Stat label="Covered by identical stock" value={num(pf.transfer.parts)} hint={`${idr(pf.transfer.valueAvoided)} not bought`} tone="good" />
        <Stat label="Excess to release" value={idr(pf.excessValuePo)} hint={`${num(pf.actions.Reduce)} materials · at PO prices`} />
        <Stat label="Stockouts in replay (May–Sep 26)" value={`${num(S.stockouts)} → ${num(A.stockouts)}`} hint={`Current Min–Max → Sparely policy · critical ${num(S.criticalStockouts)} → ${num(A.criticalStockouts)}`} tone="good" />
        <Stat label="Demand days served from stock" value={`${pct(S.servedDays / S.demandDays)} → ${pct(A.servedDays / A.demandDays)}`} hint={`Inventory held ${pct(A.avgInventoryValue / S.avgInventoryValue - 1)}`} />
      </div>

      <h2 className="mb-2 mt-6 text-[13.5px] font-semibold text-ink">My work</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map(({ id, icon: Icon, value, label }) => {
          const r = ROLES.find((x) => x.id === id)!;
          return (
            <Link key={id} href={`/workspace/${id}`} className="group flex flex-col rounded border border-line bg-surface hover:border-accent hover:shadow-sm">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
                <Icon size={16} className="text-accent" aria-hidden />
                <span className="text-[13.5px] font-semibold text-ink">{r.name}</span>
              </div>
              <div className="flex-1 px-4 py-3">
                <div className="tabular text-[26px] font-semibold leading-none text-ink">{value}</div>
                <div className="mt-1 text-xs text-muted">{label}</div>
                <p className="mt-3 text-xs leading-relaxed text-ink-2">{r.question}</p>
              </div>
              <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs">
                <span className="text-muted">{r.who}</span>
                <span className="inline-flex items-center gap-1 font-semibold text-accent group-hover:underline">Open <ArrowRight size={13} aria-hidden /></span>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-2"><DecisionSummary /></div>

      <Card title="Process" subtitle="From SAP extracts to an approved purchase requisition" className="mt-6">
        <ol className="grid gap-px overflow-hidden rounded border border-line bg-line md:grid-cols-5">
          {flow.map(({ icon: Icon, t, d }, i) => (
            <li key={t} className="bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-white">{i + 1}</span>
                <span className="text-[13px] font-semibold">{t.replace(/^\d · /, "")}</span>
                <Icon size={14} className="ml-auto text-muted" aria-hidden />
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Case requirements coverage" subtitle="Each expected output of the brief, where it is in the system, and the live evidence" className="mt-4">
        <Table>
          <thead><tr><Th>Expected output / key question</Th><Th>Where</Th><Th>Evidence (live)</Th></tr></thead>
          <tbody>
            {brief.map(([req, href, page, ev]) => (
              <tr key={req}>
                <Td>{req}</Td>
                <Td className="whitespace-nowrap"><Link href={href} className="font-semibold text-accent hover:underline">{page}</Link></Td>
                <Td className="text-ink-2">{ev}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
