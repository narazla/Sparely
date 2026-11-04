import { notFound } from "next/navigation";
import { CostCurve, ForecastChart } from "@/components/charts";
import { ActionChip, Card, Chip, CritChip, HealthChip, Note, PageHeader, SafetyChips, Stat, Table, Td, Th, UrgencyChip } from "@/components/ui";
import { getMeta, materialDetail, mlFeatures } from "@/lib/data";
import { date, idr, num, pct, qty } from "@/lib/format";
import { currentParams } from "@/lib/server-params";

export const dynamic = "force-dynamic";

function monthsBetween(from: string, to: string) {
  const out: string[] = [];
  const d = new Date(from.slice(0, 7) + "-01T00:00:00Z");
  const end = to.slice(0, 7);
  while (d.toISOString().slice(0, 7) <= end) {
    out.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

export default async function MaterialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await currentParams();
  const d = materialDetail(Number(id), p);
  if (!d) notFound();
  const { material: m, rec: r, curve } = d;
  const meta = getMeta();

  const hist = new Map(d.history.map((h) => [h.month, h]));
  const series = [
    ...monthsBetween(meta.history_start, meta.history_end).map((mo) => {
      const h = hist.get(mo);
      return { month: mo, actual: h ? h.unplanned + h.preventive : 0, forecast: null, planned: null, band: null };
    }),
    ...d.forecast.map((f) => ({
      month: f.month,
      actual: null,
      forecast: f.total * p.demandFactor,
      planned: f.planned > 0 ? f.planned * p.demandFactor : null,
      band: [f.p10 * p.demandFactor, f.p90 * p.demandFactor] as unknown as number,
    })),
  ];
  const turnaround = d.history.reduce((a, h) => a + h.turnaround, 0);
  const ml = mlFeatures(m.material_no);

  return (
    <>
      <PageHeader crumbs={[{ label: "Analytics" }, { label: "Material List", href: "/recommendations" }, { label: String(m.material_no) }]} title={m.description} subtitle={`Material ${m.material_no} · ${m.category} · Plant 1000`}>
        <div className="flex flex-wrap items-center gap-2">
          <CritChip crit={m.criticality} />
          <SafetyChips sce={r.sce} longLead={r.long_lead} />
          <ActionChip action={r.action} />
          <UrgencyChip urgency={r.urgency} />
          <HealthChip health={r.health} />
        </div>
      </PageHeader>

      <section className="mb-4 rounded border border-line bg-surface">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-4 py-3 text-[13px] md:grid-cols-4 xl:grid-cols-8">
          {([
            ["Material", String(m.material_no)],
            ["Category", m.category],
            ["Base unit", m.unit],
            ["MRP type", m.mrp_type],
            ["Criticality", `${m.criticality} (${m.n_funcloc_critical} of ${m.n_funcloc} FuncLocs A/B${m.n_funcloc_sce > 0 ? `, ${m.n_funcloc_sce} safety/shutdown valve` : ""})`],
            ["Supplier", m.supplier_name ?? "No PO history"],
            ["Lead time", `${num(m.lt_mean, 0)} d · P80 ${num(m.lt_p80, 0)} d`],
            ["Unit price", `${idr(r.price)}${m.price_source === "PO history" ? "" : " (est.)"}`],
          ] as const).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11.5px] text-muted">{k}</dt>
              <dd className="truncate font-semibold text-ink" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
        <nav className="flex gap-5 overflow-x-auto border-t border-line px-4 text-[13px]">
          {[["#recommendation", "Recommendation"], ["#forecast", "Forecast & cost"], ["#equipment", "Equipment & supply"], ["#planned", "Planned demand & notifications"], ["#history", "Goods issues"]].map(([h, l]) => (
            <a key={h} href={h} className="whitespace-nowrap border-b-2 border-transparent py-2 font-semibold text-ink-2 hover:border-accent hover:text-accent">{l}</a>
          ))}
        </nav>
      </section>

      <div id="recommendation" className="scroll-mt-16" />
      <Card title="Recommendation" className="mb-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <ul className="space-y-1.5 text-sm text-ink">
            {r.reasons.map((t, i) => <li key={i} className="flex gap-2"><span className="text-muted">{i + 1}.</span>{t}</li>)}
          </ul>
          {r.action === "Reorder" && (
            <div className="rounded border border-line bg-surface-2 p-4 text-sm lg:w-64">
              <div className="text-xs text-muted">Proposed purchase requisition</div>
              <div className="mt-1 text-xl font-semibold">{qty(r.order_qty)} {m.unit}</div>
              <div className="text-ink-2">{idr(r.order_value)} · order by {date(r.order_by)}</div>
              <div className="mt-1 text-xs text-muted">Expected arrival ≈ {Math.round(r.lead_time_days)} days</div>
              {r.requires_approval && <div className="mt-2 text-xs font-semibold text-accent-ink">Needs Management sign-off before it reaches the PR draft</div>}
            </div>
          )}
        </div>
        {r.flags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{r.flags.map((f) => <Chip key={f} tone="neutral">{f}</Chip>)}</div>}
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="On hand / on order" value={`${qty(m.stock)} / ${qty(m.on_order_qty)}`} hint={m.next_delivery ? `next delivery ${date(m.next_delivery)}` : "no open PO"} />
        <Stat label="Today Min / Max" value={`${qty(m.min_qty)} / ${qty(m.max_qty)}`} hint="static parameters in BoM" />
        <Stat label="Rec. Min (reorder point)" value={r.stocked ? qty(r.reorder_point) : "–"} hint={`safety stock ${qty(r.safety_stock)}`} />
        <Stat label="Rec. Max" value={r.stocked ? qty(r.max_level) : "don't stock"} hint={`order qty ${qty(r.order_qty_policy)}`} />
        <Stat label="Service level" value={r.stocked ? pct(r.service_level, 1) : "–"} hint={`stockout risk now ${pct(r.stockout_risk)}`} />
        <Stat label="Unit price" value={idr(r.price)} hint={m.price_source} />
      </div>
      <div className="mt-3 rounded border border-line bg-surface p-4 text-[13px]">
        <span className="font-semibold">ML early warning:</span> {pct(m.p_demand_90d, 0)} probability this part is needed in the next 90 days
        {m.p_demand_90d >= 0.3 ? <span className="text-critical-ink"> (above the 30% warning threshold)</span> : <span className="text-muted"> (below the 30% warning threshold)</span>}.
        {ml && (
          <span className="text-ink-2">
            {" "}Inputs: {num(ml.issue_days_180)} issue days in the last 180 days, last issue {ml.days_since_last > 500 ? "never" : `${num(ml.days_since_last)} days ago`}, {num(ml.notif_fl_90)} failure notifications on its equipment in 90 days, {num(ml.planned_jobs)} planned jobs in 90 days, {num(ml.pr_lines_180)} PRs in 180 days.
          </span>
        )}
      </div>

      <div id="forecast" className="mt-4 grid scroll-mt-16 gap-4 xl:grid-cols-5">
        <Card title="Consumption history and 12-month forecast" subtitle={`Units per month. Turnaround issues (${qty(turnaround)} units) excluded from the baseline.`} className="xl:col-span-3">
          <ForecastChart data={series} unit={m.unit} />
          <Note>
            Demand pattern <b>{m.demand_class}</b> · {num(m.n_events)} issue days · {m.abnormal_events > 0 ? `${num(m.abnormal_events)} abnormal issue(s) capped · ` : ""}method: {m.forecast_method}.
          </Note>
        </Card>
        <Card title="Cost of each service level" subtitle="Annual holding vs downtime-risk cost for this part" className="xl:col-span-2">
          <CostCurve points={curve.points} />
          <Note>
            Not stocking at all would cost {idr(curve.noStock.total)}/yr in expected downtime and emergency buys. A stockout here stops production with probability {pct(r.downtime_prob, 2)} for ~{num(r.emergency_days, 0)} days.
          </Note>
        </Card>
      </div>

      <div id="equipment" className="mt-4 grid scroll-mt-16 gap-4 xl:grid-cols-2">
        <Card title={`Installed on ${num(m.n_funcloc)} functional locations`} subtitle={`${num(m.n_funcloc_critical)} with criticality A/B · ${qty(m.installed_qty_total)} units installed`}>
          <Table>
            <thead><tr><Th>FuncLoc</Th><Th>Crit.</Th><Th right>Installed</Th><Th right>Notifications</Th><Th right>Failures / yr</Th></tr></thead>
            <tbody>
              {d.funclocs.slice(0, 12).map((f) => (
                <tr key={f.funcloc}><Td>{f.funcloc}<div className="text-xs text-muted">{f.description}</div></Td><Td><CritChip crit={f.criticality as "A"} /></Td><Td right>{qty(f.installed_qty)}</Td><Td right>{num(f.notif_count)}</Td><Td right>{f.failure_rate_yr.toFixed(2)}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card title="Lead time and procurement" subtitle={`Lead time ${num(m.lt_mean, 0)} ± ${num(m.lt_std, 0)} days (${m.lt_source}, ${num(m.lt_n)} PO lines) · on-time ${m.on_time_rate != null ? pct(m.on_time_rate) : "–"}`}>
          {d.purchases.length ? (
            <Table>
              <thead><tr><Th>PR date</Th><Th>Type</Th><Th right>Qty</Th><Th right>Unit price</Th><Th>Delivery</Th><Th right>Lead time</Th></tr></thead>
              <tbody>
                {d.purchases.slice(0, 10).map((x, i) => (
                  <tr key={i}><Td>{date(x.pr_date)}</Td><Td>{x.pr_type}<div className="text-xs text-muted">{x.pr_type_label}</div></Td><Td right>{qty(x.qty)}</Td><Td right>{idr(x.unit_price_idr)}</Td><Td>{date(x.po_delivery_date)}{x.is_open ? <div className="text-xs text-accent">open</div> : null}</Td><Td right>{x.lead_time_days} d</Td></tr>
                ))}
              </tbody>
            </Table>
          ) : <p className="text-sm text-muted">No purchase history: price and lead time are estimated from parts of the same category.</p>}
        </Card>
      </div>

      <div id="planned" className="mt-4 grid scroll-mt-16 gap-4 xl:grid-cols-2">
        <Card title="Planned maintenance demand (next 12 months)">
          {d.planned.length ? (
            <Table>
              <thead><tr><Th>Due</Th><Th>FuncLoc</Th><Th>Job</Th><Th right>Qty</Th></tr></thead>
              <tbody>{d.planned.map((x, i) => <tr key={i}><Td>{date(x.due_date)}</Td><Td>{x.funcloc}</Td><Td>{x.task}</Td><Td right>{qty(x.qty)}</Td></tr>)}</tbody>
            </Table>
          ) : <p className="text-sm text-muted">No part-consuming maintenance job uses this part in the next 12 months.</p>}
        </Card>
        <Card title="Recent notifications on its equipment">
          {d.notifications.length ? (
            <Table>
              <thead><tr><Th>Date</Th><Th>Priority</Th><Th>FuncLoc</Th><Th>Description</Th></tr></thead>
              <tbody>{d.notifications.slice(0, 10).map((n, i) => <tr key={i}><Td className="whitespace-nowrap">{date(n.notification_date)}</Td><Td>{n.priority}</Td><Td>{n.funcloc}</Td><Td className="text-ink-2">{n.description}</Td></tr>)}</tbody>
            </Table>
          ) : <p className="text-sm text-muted">No notifications on the equipment this part is installed on.</p>}
        </Card>
      </div>

      <div id="history" className="scroll-mt-16" />
      <Card title="Recent goods issues" className="mt-4">
        {d.movements.length ? (
          <Table>
            <thead><tr><Th>Posting date</Th><Th right>Qty</Th><Th>Order</Th><Th>Order type</Th></tr></thead>
            <tbody>{d.movements.slice(0, 15).map((x, i) => <tr key={i}><Td>{date(x.posting_date)}</Td><Td right>{qty(x.qty)}</Td><Td>{x.order_no}</Td><Td>{x.order_type}</Td></tr>)}</tbody>
          </Table>
        ) : <p className="text-sm text-muted">Never issued in the 17-month history.</p>}
      </Card>
    </>
  );
}
