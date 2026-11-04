import { ForecastChart, StackedMonthly } from "@/components/charts";
import { Card, MaterialLink, Note, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { backtest, consumptionByType, demandClasses, forecastAggregate, forecastMethods, getMeta, mlCalibration, mlImportance, mlMetrics, plannedSummary, upcomingTasks } from "@/lib/data";
import { date, num, pct, qty } from "@/lib/format";
import { abnormalRecent } from "@/lib/workflow";

export const dynamic = "force-dynamic";

const CLASS_TEXT: Record<string, string> = {
  Smooth: "Regular demand, regular size",
  Erratic: "Regular timing, very variable size",
  Intermittent: "Sporadic timing, stable size",
  Lumpy: "Sporadic timing, variable size",
  "Single issue": "Issued in only one month",
  "No demand": "Never issued in 17 months",
};

export default async function ForecastPage() {
  const meta = getMeta();
  const hist = new Map<string, number>();
  for (const r of consumptionByType()) if (r.order_type !== "Turnaround") hist.set(r.month, (hist.get(r.month) ?? 0) + r.qty);
  const fc = forecastAggregate();
  const series = [
    ...[...hist.entries()].map(([month, actual]) => ({ month, actual, forecast: null, planned: null })),
    ...fc.map((f) => ({ month: f.month, actual: null, forecast: f.total, planned: f.planned })),
  ];
  const classes = demandClasses();
  const methods = forecastMethods();
  const bt = backtest();
  const ours = bt.find((b) => b.method.startsWith("CALIBER"));
  const stat = bt.find((b) => b.method.startsWith("Static"));
  const planned = new Map<string, { month: string; Overhaul: number; Replacement: number; Lubrication: number }>();
  for (const r of plannedSummary()) {
    const row = planned.get(r.month) ?? { month: r.month, Overhaul: 0, Replacement: 0, Lubrication: 0 };
    row[r.task_category as "Overhaul" | "Replacement" | "Lubrication"] += r.events;
    planned.set(r.month, row);
  }
  const tasks = upcomingTasks(12);
  const ml = mlMetrics();
  const calib = mlCalibration();
  const imp = mlImportance().slice(0, 8);
  const mlRow = ml.find((m) => m.model.startsWith("ML"));
  const abnormal = abnormalRecent(90);
  const totalFc = fc.reduce((a, f) => a + f.total, 0);
  const totalPlanned = fc.reduce((a, f) => a + f.planned, 0);

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Analytics" }, { label: "Demand Forecast" }]}
        title="Demand Forecasting"
        subtitle="Hybrid demand intelligence: planned demand from the maintenance plan + failure-driven demand from each part's own history, pooled with the failure rate of every piece of equipment it is installed on."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Forecast next 12 months" value={`${qty(totalFc)} units`} hint={`${qty(totalPlanned)} units from planned maintenance jobs`} />
        <Stat label="Parts with irregular demand" value={pct(1 - (classes.find((c) => c.demand_class === "Smooth")?.materials ?? 0) / Number(meta.materials))} hint="Intermittent, lumpy, erratic, single-issue or never used" />
        <Stat label="Forecast bias (backtest)" value={`${pct(ours?.bias ?? 0, 0)} vs ${pct(stat?.bias ?? 0, 0)}`} hint="Sparely model vs static average, May–Sep 2026 hold-out" tone="good" />
        <Stat label="Demand detection AUC" value={(ours?.auc_occurrence ?? 0).toFixed(3)} hint="Ranks which parts will be needed (1.0 = perfect, 0.5 = random)" />
      </div>

      <Card title="Total spare-part demand: history and 12-month forecast" subtitle="Units per month, all parts. History excludes turnaround issues (handled as event demand)." className="mt-4">
        <ForecastChart data={series} />
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Demand patterns (Syntetos–Boylan classification)" subtitle="Monthly demand, 17 months, turnaround excluded">
          <Table>
            <thead><tr><Th>Pattern</Th><Th>Meaning</Th><Th right>Parts</Th><Th right>Forecast 12m</Th></tr></thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.demand_class}><Td className="font-medium">{c.demand_class}</Td><Td className="text-ink-2">{CLASS_TEXT[c.demand_class]}</Td><Td right>{num(c.materials)}</Td><Td right>{qty(c.forecast_12m)}</Td></tr>
              ))}
            </tbody>
          </Table>
          <Note>Only {num(classes.find((c) => c.demand_class === "Smooth")?.materials ?? 0)} parts have smooth demand, so a single moving-average or Min–Max rule cannot work. Each part gets the method its evidence supports:</Note>
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {methods.map((m) => <li key={m.forecast_method}>• <b className="text-ink">{num(m.materials)}</b> parts — {m.forecast_method}</li>)}
          </ul>
        </Card>
        <Card title="Backtest: train May 2025 – Apr 2026, test May – Sep 2026" subtitle="Units per part over the 5-month hold-out, turnaround excluded">
          <Table>
            <thead><tr><Th>Method</Th><Th right>WAPE</Th><Th right>Bias</Th><Th right>AUC</Th></tr></thead>
            <tbody>
              {bt.map((b) => (
                <tr key={b.method}><Td className={b.method.startsWith("CALIBER") ? "font-semibold" : ""}>{b.method}</Td><Td right>{pct(b.wape)}</Td><Td right>{b.bias >= 0 ? "+" : ""}{pct(b.bias)}</Td><Td right>{b.auc_occurrence.toFixed(3)}</Td></tr>
              ))}
            </tbody>
          </Table>
          <Note>
            WAPE = total absolute error ÷ actual demand. Bias = over-forecast (+) or under-forecast (−); a static average over-forecasts by ~{pct(stat?.bias ?? 0)} because it repeats turnaround and abnormal issues, which over-stocks the warehouse. AUC measures how well the model ranks which parts will be demanded — {num(Number(meta.backtest_new_materials))} parts with no training history were demanded in the test window, and only the installed-base prior can anticipate them.
          </Note>
        </Card>
      </div>

      <div id="ml" className="mt-4 grid scroll-mt-6 gap-4 xl:grid-cols-3">
        <Card title="ML early warning: will this part be needed in the next 90 days?" subtitle={`Gradient boosting on ${num(Number(meta.ml_train_rows))} part-month snapshots; tested out-of-time on ${num(Number(meta.ml_test_rows))} (origins ${meta.ml_test_window})`} className="xl:col-span-2">
          <Table>
            <thead><tr><Th>Model</Th><Th right>AUC</Th><Th right>Avg precision</Th><Th right>Brier</Th><Th right>Hit rate, top 10%</Th></tr></thead>
            <tbody>
              {ml.map((m) => (
                <tr key={m.model}>
                  <Td className={m.model.startsWith("ML") ? "font-semibold" : ""}>{m.model}</Td>
                  <Td right>{m.auc.toFixed(3)}</Td><Td right>{m.avg_precision.toFixed(3)}</Td><Td right>{m.brier != null ? m.brier.toFixed(3) : "–"}</Td><Td right>{pct(m.top_decile_precision)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Note>
            Each row is a part at a monthly origin date; features use only data before the origin, the label is any non-turnaround issue in the next 90 days.
            Base rate {pct(mlRow?.base_rate ?? 0, 1)}: of the 10% of parts the model ranks highest, {pct(mlRow?.top_decile_precision ?? 0)} were actually needed ({((mlRow?.top_decile_precision ?? 0) / (mlRow?.base_rate || 1)).toFixed(1)}× better than picking at random).
            The model complements the quantity forecast: it decides which parts to watch, the compound-Poisson model decides how many.
          </Note>
          <h3 className="mb-2 mt-4 text-sm font-semibold">Calibration on the hold-out</h3>
          <Table>
            <thead><tr><Th>Predicted probability</Th><Th right>Parts</Th><Th right>Mean predicted</Th><Th right>Actually needed</Th></tr></thead>
            <tbody>{calib.map((c) => <tr key={c.bin}><Td>{c.bin.replace("(-0.001", "[0")}</Td><Td right>{num(c.parts)}</Td><Td right>{pct(c.predicted, 1)}</Td><Td right>{pct(c.observed, 1)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card title="What drives the prediction" subtitle="Permutation importance on the hold-out (drop in AUC when the feature is shuffled)">
          <ul className="space-y-2 text-sm">
            {imp.map((f) => (
              <li key={f.feature}>
                <div className="flex justify-between gap-2"><span className="text-ink">{f.description}</span><span className="tabular text-muted">{f.importance.toFixed(3)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, (f.importance / imp[0].importance) * 100)}%`, background: "var(--series-1)" }} /></div>
              </li>
            ))}
          </ul>
          <Note>Installed base (how many FuncLocs a part sits on), price class, recent purchasing and lead time carry most of the signal — the same drivers the statistical model uses, learned from data instead of fixed.</Note>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Known future demand from the maintenance plan" subtitle="Part-consuming jobs due per month (overhaul, filter replacement, lubrication)">
          <StackedMonthly
            data={[...planned.values()]}
            series={[{ key: "Overhaul", label: "Overhaul" }, { key: "Replacement", label: "Replacement" }, { key: "Lubrication", label: "Lubrication" }]}
            unit="part lines"
            height={240}
          />
          <Note>
            A job consumes the parts in its FuncLoc&apos;s BoM that this kind of job replaces, at Installed Qty × a usage factor of {Number(meta.planned_factor).toFixed(2)} calibrated from preventive-order history. Inspection, calibration and test jobs consume none.
          </Note>
        </Card>
        <Card title="Next part-consuming maintenance jobs">
          <Table>
            <thead><tr><Th>Due</Th><Th>Equipment</Th><Th>Job</Th><Th>Parts it uses</Th></tr></thead>
            <tbody>
              {tasks.map((t, i) => (
                <tr key={i}><Td className="whitespace-nowrap">{date(t.next_due)}</Td><Td>{t.funcloc}<div className="text-xs text-muted">{t.fl_description} · crit. {t.abc_indicator}</div></Td><Td>{t.task}</Td><Td className="text-xs text-ink-2">{t.part_categories}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card title="Abnormal consumption — last 90 days" subtitle="Issues far above the part's normal size (robust z-score > 3.5). They are capped in the forecast so one unusual issue does not inflate stock levels; check for misuse, wrong bookings or a new failure mode." className="mt-4">
        {abnormal.length ? (
          <Table>
            <thead><tr><Th>Date</Th><Th>Part</Th><Th right>Issued</Th><Th right>Normal up to</Th></tr></thead>
            <tbody>{abnormal.slice(0, 12).map((a, i) => (
              <tr key={i}><Td className="whitespace-nowrap">{date(a.posting_date)}</Td><Td><MaterialLink id={a.material_no} /><div className="text-xs text-muted">{a.description}</div></Td><Td right>{qty(a.qty)} {a.unit}</Td><Td right>{qty(a.threshold)}</Td></tr>
            ))}</tbody>
          </Table>
        ) : <p className="text-sm text-muted">No abnormal issues in the last 90 days.</p>}
        {abnormal.length > 12 && <Note>{num(abnormal.length)} abnormal issues in the last 90 days; the 12 most recent are shown.</Note>}
      </Card>
    </>
  );
}
