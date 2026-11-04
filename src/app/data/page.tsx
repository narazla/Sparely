import { Card, Note, PageHeader, Table, Td, Th } from "@/components/ui";
import { assumptions, dataGaps, dataQuality, downtimeProbabilities, getImpact, getMeta, getRecommendations, portfolio, suppliers, tableCounts } from "@/lib/data";
import { date, idr, num, pct } from "@/lib/format";
import { DEFAULT_PARAMS } from "@/lib/params";
import type { Params } from "@/lib/types";

export const dynamic = "force-dynamic";

const SOURCES = [
  { file: "BoM", role: "Spare Part Master + Current Inventory Position", use: "Stock, static Min/Max, MRP type, Installed Qty per FuncLoc (installed-base population)" },
  { file: "FuncLoc list", role: "Equipment criticality", use: "A/B/C/S criticality (A highest) → part criticality, equipment class for failure-rate pooling" },
  { file: "Notif History", role: "Failure history", use: "Failure rate per FuncLoc (installed-base prior), emergency frequency (downtime calibration)" },
  { file: "Movement Material", role: "Consumption history", use: "Demand events, recency weighting, abnormal-issue detection, order type split" },
  { file: "PR PO", role: "Procurement & lead time", use: "Unit price, lead time mean/variability, supplier reliability, open POs (on order)" },
  { file: "Mitem & Mplan", role: "Maintenance plan", use: "Next due dates of part-consuming jobs → known future demand" },
];

const STEPS = [
  ["1. Clean & link", "Deduplicate BoM and PR PO, normalize 28 cycle formats, convert currencies, link Notif → Order → Movement and BoM → FuncLoc."],
  ["2. Split demand by cause", "Turnaround issues become event demand; preventive demand is replaced by the maintenance plan forecast; the rest is failure-driven."],
  ["3. Forecast irregular demand", "Recency-weighted compound Poisson per part, blended by credibility with an installed-base prior (failure rate of every FuncLoc the part sits on). Never-used parts get a data-estimated first-demand rate."],
  ["4. Add known future demand", "Part-consuming jobs from the maintenance plan, mapped to the parts they replace, at a usage factor calibrated on history."],
  ["5. ML early warning", "Gradient boosting trained on 12 monthly snapshots (features before the date, label = demand in the next 90 days), validated out-of-time, then refit and scored on the planning date."],
  ["6. Optimize each part", "Lead-time demand distribution (Poisson for slow movers, normal otherwise) → safety stock, reorder point, EOQ order quantity, Max. The service level is chosen to minimize holding + ordering + downtime-risk cost, or set by criticality."],
  ["7. Identical stock first", "Material numbers with the same description and unit are linked; a need is covered by a twin's stock above its own reorder point before anything is bought."],
  ["8. Recommend & route", "Reorder / transfer / reduce / monitor / maintain with reasons, health status, stockout and overstock risk; worklists per role, PR draft, decision impact, scenarios."],
  ["9. Prove by replay", "The policy is rebuilt from data before 1 May 2026, then the actual May–Sep 2026 issues are replayed day by day against today's Min–Max and the Sparely policy."],
];

export default async function DataPage() {
  const meta = getMeta();
  const impact = getImpact();
  const probs = downtimeProbabilities();
  const counts = tableCounts();
  const gaps = dataGaps();
  const d = DEFAULT_PARAMS;
  const k = (x: number) => ({ S: d.downtimeCostPerDay.S * x, A: d.downtimeCostPerDay.A * x, B: d.downtimeCostPerDay.B * x, C: d.downtimeCostPerDay.C * x });
  const sens = [
    { label: "Downtime cost × 0.5", p: { ...d, downtimeCostPerDay: k(0.5) } },
    { label: "Base case", p: d },
    { label: "Downtime cost × 2", p: { ...d, downtimeCostPerDay: k(2) } },
    { label: "Holding cost 15% / yr", p: { ...d, holdingRate: 0.15 } },
    { label: "Holding cost 30% / yr", p: { ...d, holdingRate: 0.3 } },
    { label: "Order cost × 2", p: { ...d, orderCost: d.orderCost * 2 } },
  ].map((s) => ({ label: s.label, pf: portfolio(s.p) }));
  const base = sens[1].pf;
  const recBase = new Map(getRecommendations(d).map((r) => [r.material_no, r.action]));
  const changed = (p: Params) => getRecommendations(p).filter((r) => recBase.get(r.material_no) !== r.action).length;
  const changes = [changed({ ...d, downtimeCostPerDay: k(0.5) }), 0, changed({ ...d, downtimeCostPerDay: k(2) }), changed({ ...d, holdingRate: 0.15 }), changed({ ...d, holdingRate: 0.3 }), changed({ ...d, orderCost: d.orderCost * 2 })];
  return (
    <>
      <PageHeader crumbs={[{ label: "Analytics" }, { label: "Data & Method" }]} title="Data & Method" subtitle="How the six baseline files become decisions, every data-quality fix applied, and every assumption — so each number can be traced and challenged." />

      <Card title="Baseline data used">
        <Table>
          <thead><tr><Th>File</Th><Th>Role in the brief</Th><Th>How the model uses it</Th></tr></thead>
          <tbody>{SOURCES.map((s) => <tr key={s.file}><Td className="font-medium">{s.file}</Td><Td>{s.role}</Td><Td className="text-ink-2">{s.use}</Td></tr>)}</tbody>
        </Table>
        <Note>Planning date {date(meta.as_of)}; history {date(meta.history_start)} – {date(meta.history_end)}. Database built {meta.generated_at.replace("T", " ")}.</Note>
      </Card>

      <Card title="Pipeline" className="mt-4">
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STEPS.map(([t, d]) => <li key={t} className="rounded-lg bg-surface-2 p-3"><div className="text-sm font-semibold">{t}</div><p className="mt-1 text-xs leading-relaxed text-ink-2">{d}</p></li>)}
        </ol>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Data-quality checks and fixes">
          <Table>
            <thead><tr><Th>Dataset</Th><Th>Check</Th><Th>Result</Th><Th>Action</Th></tr></thead>
            <tbody>{dataQuality().map((q, i) => <tr key={i}><Td className="whitespace-nowrap">{q.dataset}</Td><Td>{q.check_name}</Td><Td className="tabular">{q.result}</Td><Td className="text-ink-2">{q.action}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="Assumptions">
          <Table>
            <thead><tr><Th>Area</Th><Th>Assumption</Th><Th>Value</Th><Th>Note</Th></tr></thead>
            <tbody>{assumptions().map((a, i) => <tr key={i}><Td className="whitespace-nowrap">{a.area}</Td><Td>{a.name}</Td><Td className="text-xs">{a.value}</Td><Td className="text-xs text-ink-2">{a.note}</Td></tr>)}</tbody>
          </Table>
        </Card>
      </div>

      <Card title="Data gaps and the additional data we propose" subtitle="Each gap limits a specific result; the proposal names the source and the business reason." className="mt-4">
        <Table>
          <thead><tr><Th>Gap in the baseline data</Th><Th>Effect today</Th><Th>Proposed additional data</Th></tr></thead>
          <tbody>
            {[
              [`No part list per maintenance task (Mplan); ${pct(gaps.mplanWithBom)} of plan items sit on a FuncLoc that has a BoM`, "Planned demand is inferred from the BoM with a calibrated usage factor", "SAP PM task lists / component lists per maintenance plan"],
              [`${pct(gaps.estimatedPrice)} of parts were never purchased in the data period`, "Their value uses category-median prices (labelled “estimated”)", "Material master standard price / moving average price (SAP MM)"],
              ["No production value per hour of downtime", "Downtime cost per day is a scenario input; sensitivity shown above", "Unit production plan × margin per tonne (e.g. ethylene) per equipment system"],
              ["Unmet demand and historical stock levels are not recorded", "Stockouts in the replay are simulated from the policies' own starting levels", "SAP stock history (MB5B) and reservation / backorder records"],
              [`Every part has a single supplier in PR PO (${num(gaps.suppliers)} suppliers)`, "Single-source risk can be flagged but not re-sourced", "Approved vendor list / source list (SAP ME01) per material"],
              ["No link from equipment to its process system (only site-level nodes)", "Results cannot be split by process unit", "FuncLoc hierarchy (superior functional location)"],
            ].map(([g, e, d]) => <tr key={g}><Td>{g}</Td><Td className="text-ink-2">{e}</Td><Td className="font-medium">{d}</Td></tr>)}
          </tbody>
        </Table>
      </Card>

      <Card title="Sensitivity of the decisions to the assumptions that cannot come from data" subtitle="Production loss per downtime day, holding-cost rate and cost per purchase order are business inputs. How much do the recommendations move if they are wrong?" className="mt-4">
        <Table>
          <thead><tr><Th>Case</Th><Th right>Reorder</Th><Th right>Reduce</Th><Th right>Parts changing action</Th><Th right>Avg inventory</Th><Th right>Production stops / yr</Th></tr></thead>
          <tbody>
            {sens.map((s, i) => (
              <tr key={s.label}>
                <Td className={i === 1 ? "font-semibold" : ""}>{s.label}</Td>
                <Td right>{num(s.pf.actions.Reorder)}</Td>
                <Td right>{num(s.pf.actions.Reduce)}</Td>
                <Td right>{i === 1 ? "–" : `${num(changes[i])} (${pct(changes[i] / base.materials, 1)})`}</Td>
                <Td right>{idr(s.pf.targetInventoryValue)}</Td>
                <Td right>{num(s.pf.recommended.downtimeEvents, 2)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Note>Halving or doubling an assumption changes the action of only the share of parts shown; the direction of the recommendations is driven by the data (demand, lead time, price, criticality, observed emergencies).</Note>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Downtime calibration">
          <p className="text-sm text-ink-2">
            Production loss per day is a business input (scenario page). How often a stockout actually stops production is learned from data: {num(impact.emergencies)} Emergency notifications in {num(impact.days)} days = <b className="text-ink">{num(impact.emergenciesPerYear, 1)} per year</b>, which today&apos;s static Min–Max must reproduce.
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
            {probs.map((p) => <div key={p.crit} className="rounded-md bg-surface-2 py-2"><div className="text-muted">{p.crit}</div><div className="tabular font-semibold">{pct(p.prob, 2)}</div></div>)}
          </div>
        </Card>
        <Card title="Suppliers (single-source exposure)">
          <Table>
            <thead><tr><Th>Supplier</Th><Th right>PO lines</Th><Th right>Parts</Th><Th right>Median LT</Th><Th right>On time</Th></tr></thead>
            <tbody>{suppliers(8).map((s) => <tr key={s.supplier_name}><Td className="text-xs">{s.supplier_name}</Td><Td right>{num(s.po_lines)}</Td><Td right>{num(s.materials)}</Td><Td right>{num(s.lt_median)} d</Td><Td right>{pct(s.on_time_rate)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="SQLite database" subtitle="data/caliber.db — read by every page and API">
          <Table>
            <thead><tr><Th>Table</Th><Th right>Rows</Th></tr></thead>
            <tbody>{counts.map((c) => <tr key={c.name}><Td className="font-mono text-xs">{c.name}</Td><Td right>{num(c.rows)}</Td></tr>)}</tbody>
          </Table>
          <Note>JSON API: /api/summary · /api/recommendations · /api/materials/[id] · /api/forecast · /api/replay · /api/scenario (POST) · /api/pr-draft (POST) · /api/impact (POST) · /api/data-quality</Note>
        </Card>
      </div>
    </>
  );
}
