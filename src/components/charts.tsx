"use client";

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { idr, month as fmtMonth, num, qty } from "@/lib/format";

const S1 = "var(--series-1)";
const S2 = "var(--series-2)";
const S3 = "var(--series-3)";
const GAP = { stroke: "var(--surface)", strokeWidth: 1.5 };

type Row = Record<string, string | number | null>;
type Fmt = (v: number) => string;

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.color && <span className="h-2 w-2 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeTip = (fmt: Fmt, titleFmt: (l: string) => string = (l) => l) => function Tip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <TipBox
      title={titleFmt(String(label))}
      rows={payload
        .filter((p: { value: unknown }) => p.value != null)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((p: any) => ({ label: p.name, value: Array.isArray(p.value) ? `${fmt(p.value[0])} – ${fmt(p.value[1])}` : fmt(Number(p.value)), color: p.color }))}
    />
  );
};

const legendStyle = { fontSize: 12, color: "var(--ink-2)", paddingTop: 4 };
const axisNum = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v));

/** Monthly consumption, stacked by demand source. */
export function StackedMonthly({ data, series, height = 260, unit = "units" }: {
  data: Row[];
  series: { key: string; label: string }[];
  height?: number;
  unit?: string;
}) {
  const colors = [S1, S2, S3];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={makeTip((v) => `${qty(v)} ${unit}`, fmtMonth)} cursor={{ fill: "var(--surface-2)" }} />
        <Legend wrapperStyle={legendStyle} iconType="square" iconSize={10} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={colors[i]} {...GAP} isAnimationActive={false} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** History (bars) + forecast (line) with an 80% prediction band. */
export function ForecastChart({ data, height = 280, unit = "units" }: { data: Row[]; height?: number; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="month" tickFormatter={fmtMonth} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
        <YAxis tickFormatter={axisNum} tickLine={false} axisLine={false} width={44} />
        <Tooltip content={makeTip((v) => `${qty(v)} ${unit}`, fmtMonth)} cursor={{ stroke: "var(--axis)" }} />
        <Legend wrapperStyle={legendStyle} iconSize={10} />
        <Area dataKey="band" name="80% range" fill="var(--band)" stroke="none" fillOpacity={0.35} isAnimationActive={false} />
        <Bar dataKey="actual" name="Actual (excl. turnaround)" fill={S1} radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
        <Bar dataKey="planned" name="Planned (maintenance plan)" fill={S3} radius={[4, 4, 0, 0]} barSize={14} isAnimationActive={false} />
        <Line dataKey="forecast" name="Forecast" stroke={S2} strokeWidth={2} dot={{ r: 3, fill: S2, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars, one series (the card title names it). `format` is a name so server pages can pass it. */
export function HBars({ data, format: fmtName = "num", height }: { data: { label: string; value: number }[]; format?: "num" | "idr"; height?: number }) {
  const format: Fmt = fmtName === "idr" ? idr : (v) => num(v);
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(160, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 72, left: 8, bottom: 0 }} barCategoryGap="28%">
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={false} />
        <Tooltip content={makeTip(format)} cursor={{ fill: "var(--surface-2)" }} />
        <Bar
          dataKey="value"
          name="Value"
          fill={S1}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          label={{ position: "right", fill: "var(--ink-2)", fontSize: 11, formatter: (v: unknown) => format(Number(v)) }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Portfolio trade-off: average inventory value vs expected downtime-risk cost, one point per service level. */
export function FrontierChart({ points, optimized, height = 320 }: {
  points: { serviceLevel: number; inventoryValue: number; riskCost: number }[];
  optimized: { inventoryValue: number; riskCost: number };
  height?: number;
}) {
  const line = points.map((p) => ({ x: p.inventoryValue, y: p.riskCost, label: `${(p.serviceLevel * 100).toFixed(1)}% service level` }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Tip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return <TipBox title={d.label} rows={[{ label: "Avg inventory value", value: idr(d.x) }, { label: "Expected risk cost / yr", value: idr(d.y) }]} />;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 16 }}>
        <CartesianGrid />
        <XAxis type="number" dataKey="x" name="Average inventory value" tickFormatter={(v) => idr(v)} tickLine={false}
          label={{ value: "Average inventory value", position: "insideBottom", offset: -10, fill: "var(--muted)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name="Expected risk cost" tickFormatter={(v) => idr(v)} tickLine={false} axisLine={false} width={78} />
        <ZAxis range={[90, 90]} />
        <Tooltip content={<Tip />} cursor={{ strokeDasharray: "3 3" }} />
        <Legend wrapperStyle={legendStyle} verticalAlign="top" height={28} />
        <Scatter name="Uniform service level (frontier)" data={line} fill={S1} line={{ stroke: S1, strokeWidth: 2 }} stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
        <Scatter name="Sparely optimized" data={[{ x: optimized.inventoryValue, y: optimized.riskCost, label: "Sparely optimized" }]} fill={S3} shape="star" stroke="var(--surface)" strokeWidth={2} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Replay: inventory value held each day by the two warehouses. */
export function ReplayChart({ data, height = 240 }: { data: { day: string; staticValue: number; aiValue: number }[]; height?: number }) {
  const rows = data.map((d) => ({ day: d.day, "Today's static Min–Max": d.staticValue, "Sparely policy": d.aiValue }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickFormatter={(d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })} tickLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v) => idr(v)} tickLine={false} axisLine={false} width={78} />
        <Tooltip content={makeTip((v) => idr(v), (l) => new Date(l + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }))} cursor={{ stroke: "var(--axis)" }} />
        <Legend wrapperStyle={legendStyle} iconSize={10} />
        <Line dataKey="Today's static Min–Max" stroke={S2} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="Sparely policy" stroke={S1} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Annual cost of one part across service levels. */
export function CostCurve({ points, height = 260 }: { points: { sl: number; holding: number; risk: number; total: number }[]; height?: number }) {
  const data = points.map((p) => ({ sl: `${(p.sl * 100).toFixed(1)}%`, Holding: p.holding, "Downtime risk": p.risk, Total: p.total }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="sl" tickLine={false} />
        <YAxis tickFormatter={(v) => idr(v)} tickLine={false} axisLine={false} width={78} />
        <Tooltip content={makeTip((v) => idr(v), (l) => `Service level ${l}`)} cursor={{ stroke: "var(--axis)" }} />
        <Legend wrapperStyle={legendStyle} iconSize={10} />
        <Line dataKey="Holding" stroke={S1} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="Downtime risk" stroke={S2} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="Total" stroke={S3} strokeWidth={2.5} dot={{ r: 4 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
