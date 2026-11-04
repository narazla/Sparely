"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, RotateCcw, Undo2, X } from "lucide-react";
import { downloadCsv, useDecisions, type DecisionKind } from "./decisions";
import { date, idr, num, qty as fq } from "@/lib/format";

export interface DecisionRow {
  material_no: number;
  description: string;
  crit: string;
  cells: string[];
  qty?: number;
  need_by?: string;
  badge?: string;
}

const btn = "btn btn-secondary btn-sm";

/** A worklist where each row gets an Approve / Reject decision (with an editable quantity when it is a buy). */
export function DecisionList({ kind, role, rows, columns, approveLabel = "Approve", qtyLabel, source, pageSize = 12, empty = "Nothing to review.", exportName }: {
  kind: DecisionKind;
  role: string;
  rows: DecisionRow[];
  columns: string[];
  approveLabel?: string;
  qtyLabel?: string;
  source?: string;
  pageSize?: number;
  empty?: string;
  /** when set, approved rows can be downloaded as CSV under this file name */
  exportName?: string;
}) {
  const { decisions, decide, undo } = useDecisions();
  const [tab, setTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Record<number, number>>({});
  const status = (id: number) => decisions[`${kind}:${id}`]?.status;
  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, rejected: 0 };
    for (const r of rows) c[status(r.material_no) ?? "pending"]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, decisions]);
  const list = rows.filter((r) => (status(r.material_no) ?? "pending") === tab);
  const pages = Math.max(1, Math.ceil(list.length / pageSize));
  const shown = list.slice(page * pageSize, page * pageSize + pageSize);
  useEffect(() => setPage(0), [tab]);

  const approveAll = () => {
    for (const r of shown) decide({ kind, material_no: r.material_no, status: "approved", qty: edits[r.material_no] ?? r.qty, need_by: r.need_by, role, source });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Filter by decision">
          {(["pending", "approved", "rejected"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}>
              {t[0].toUpperCase() + t.slice(1)} ({num(counts[t])})
            </button>
          ))}
        </div>
        {tab === "pending" && shown.length > 0 && (
          <button onClick={approveAll} className={`${btn} ml-auto`}>
            <Check size={13} aria-hidden /> {approveLabel} all {shown.length} shown
          </button>
        )}
        {tab === "approved" && exportName && counts.approved > 0 && (
          <button
            className={`${btn} ml-auto`}
            onClick={() =>
              downloadCsv(exportName, ["material_no", "description", ...columns, ...(qtyLabel ? [qtyLabel] : [])],
                rows.filter((r) => status(r.material_no) === "approved").map((r) => [r.material_no, r.description, ...r.cells, ...(qtyLabel ? [decisions[`${kind}:${r.material_no}`]?.qty ?? ""] : [])]))
            }
          >
            <Download size={13} aria-hidden /> Download approved (CSV)
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{tab === "pending" ? empty : `No ${tab} items yet.`}</p>
      ) : (
        <div className="-mx-4 overflow-x-auto">
          <table className="dtable w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="text-left">Material</th>
                {columns.map((c) => <th key={c} className="text-right">{c}</th>)}
                {qtyLabel && <th className="text-right">{qtyLabel}</th>}
                <th className="text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const s = status(r.material_no);
                const q = edits[r.material_no] ?? decisions[`${kind}:${r.material_no}`]?.qty ?? r.qty;
                return (
                  <tr key={r.material_no}>
                    <td>
                      <span className="flex items-center gap-2">
                        <span title={`Criticality ${r.crit}`} className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm px-1 text-[11px] font-bold ${r.crit === "A" || r.crit === "B" ? "bg-ink text-white" : "border border-line text-ink-2"}`}>{r.crit}</span>
                        <Link href={`/materials/${r.material_no}`} className="tabular font-semibold text-accent hover:underline">{r.material_no}</Link>
                        {r.badge && <span className="rounded-sm border border-line bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-ink-2">{r.badge}</span>}
                      </span>
                      <div className="max-w-80 truncate text-xs text-muted" title={r.description}>{r.description}</div>
                    </td>
                    {r.cells.map((c, i) => <td key={i} className="tabular text-right">{c}</td>)}
                    {qtyLabel && (
                      <td className="text-right">
                        {s ? <span className="tabular">{q != null ? fq(q) : "–"}</span> : (
                          <input type="number" min={0} value={q ?? 0} onChange={(e) => setEdits((x) => ({ ...x, [r.material_no]: Number(e.target.value) }))}
                            className="input tabular w-24 text-right" />
                        )}
                      </td>
                    )}
                    <td className="text-right">
                      {s ? (
                        <span className="inline-flex items-center gap-2">
                          <span className={`text-xs font-semibold ${s === "approved" ? "text-good-ink" : "text-critical-ink"}`}>{s === "approved" ? "Approved" : "Rejected"}</span>
                          <button onClick={() => undo(kind, r.material_no)} className={btn} title="Undo"><Undo2 size={13} aria-hidden /></button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1.5">
                          <button onClick={() => decide({ kind, material_no: r.material_no, status: "approved", qty: q, need_by: r.need_by, role, source })} className="btn btn-accept btn-sm">
                            <Check size={13} aria-hidden /> {approveLabel}
                          </button>
                          <button onClick={() => decide({ kind, material_no: r.material_no, status: "rejected", role, source })} className="btn btn-reject btn-sm">
                            <X size={13} aria-hidden /> Reject
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="btn btn-ghost btn-sm">‹ Previous</button>
          <span>{num(page * pageSize + 1)}–{num(Math.min(list.length, (page + 1) * pageSize))} of {num(list.length)}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="btn btn-ghost btn-sm">Next ›</button>
        </div>
      )}
    </div>
  );
}

interface PrLine {
  material_no: number; description: string; unit: string; qty: number; need_by: string; expected_delivery: string;
  pr_type: string; purchasing_group: string; purchasing_group_source: string; supplier: string; unit_price: number;
  price_source: string; value: number; lead_time_days: number; late_risk: boolean; single_source: boolean; criticality: string; source: string;
}

/** Procurement: approved buys from the planner and the maintenance team become PR lines. */
export function PrQueue() {
  const { decisions } = useDecisions();
  const [lines, setLines] = useState<PrLine[]>([]);
  const [loading, setLoading] = useState(false);
  const items = useMemo(
    () => Object.values(decisions)
      .filter((d) => d.status === "approved" && (d.kind === "reorder" || d.kind === "request" || d.kind === "tam" || d.kind === "insurance") && (d.qty ?? 0) > 0)
      .map((d) => ({
        material_no: d.material_no,
        qty: d.qty!,
        need_by: d.need_by,
        source: d.kind === "reorder" ? "Planner reorder" : d.kind === "request" ? "Maintenance job" : d.kind === "tam" ? "Turnaround" : "Insurance spare",
      })),
    [decisions]
  );
  useEffect(() => {
    if (!items.length) {
      setLines([]);
      return;
    }
    setLoading(true);
    fetch("/api/pr-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) })
      .then((r) => r.json())
      // grouped by owning department (Purchasing Group) so each department gets its own approval list
      .then((d) => setLines(((d.lines ?? []) as PrLine[]).sort((a, b) => a.purchasing_group.localeCompare(b.purchasing_group) || a.need_by.localeCompare(b.need_by))))
      .finally(() => setLoading(false));
  }, [items]);
  const total = lines.reduce((a, l) => a + l.value, 0);

  if (!items.length)
    return (
      <p className="py-6 text-center text-sm text-muted">
        No approved buys yet. Approve reorders in the <Link href="/workspace/planner" className="text-accent hover:underline">Planner</Link> workspace or request job parts in the{" "}
        <Link href="/workspace/maintenance" className="text-accent hover:underline">Maintenance</Link> workspace — they land here as PR lines.
      </p>
    );
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-2">{loading ? "Building PR lines…" : <><b className="text-ink">{num(lines.length)}</b> PR lines · <b className="text-ink">{idr(total)}</b> · {num(lines.filter((l) => l.late_risk).length)} cannot arrive by the need date</>}</span>
        <button
          className={btn}
          onClick={() =>
            downloadCsv("purchase-requisition-draft.csv",
              ["material_no", "description", "qty", "unit", "need_by", "pr_type", "purchasing_group", "plant", "suggested_supplier", "unit_price_idr", "value_idr", "lead_time_days", "expected_delivery", "source"],
              lines.map((l) => [l.material_no, l.description, l.qty, l.unit, l.need_by, l.pr_type, l.purchasing_group, 1000, l.supplier, Math.round(l.unit_price), Math.round(l.value), l.lead_time_days, l.expected_delivery, l.source]))
          }
        >
          <Download size={13} aria-hidden /> Export PR draft (CSV)
        </button>
      </div>
      <div className="-mx-4 overflow-x-auto">
        <table className="dtable w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="text-xs text-muted">
              {["Part", "Source", "Qty", "Need by", "PR type / group", "Supplier", "Value", "Lead time"].map((h, i) => <th key={h} className={`${i >= 2 && i !== 4 && i !== 5 ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.material_no}>
                <td className=""><Link href={`/materials/${l.material_no}`} className="tabular font-semibold text-accent hover:underline">{l.material_no}</Link><div className="max-w-64 truncate text-xs text-muted">{l.description}</div></td>
                <td className="text-xs">{l.source}</td>
                <td className="tabular text-right">{fq(l.qty)} <span className="text-muted">{l.unit}</span></td>
                <td className="tabular text-right">{date(l.need_by)}{l.late_risk && <div className="text-xs text-critical-ink">arrives {date(l.expected_delivery)}</div>}</td>
                <td className="text-xs">{l.pr_type} · {l.purchasing_group}<div className="text-muted">{l.purchasing_group_source}</div></td>
                <td className="text-xs">{l.supplier}{l.single_source && <div className="text-muted">single source</div>}</td>
                <td className="tabular text-right">{idr(l.value)}<div className="text-xs text-muted">{l.price_source}</div></td>
                <td className="tabular text-right">{l.lead_time_days} d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface Impact {
  approved: number; rejected: number; orders: { count: number; value: number; critical: number }; transfers: { count: number; valueAvoided: number }; released: { count: number; value: number };
  params: number; insurance: number; riskAvoided: number; downtimeEventsAvoided: number;
}

/** Management: what the decisions taken so far change. */
export function ImpactPanel() {
  const { decisions, clearAll } = useDecisions();
  const [imp, setImp] = useState<Impact | null>(null);
  const list = useMemo(() => Object.values(decisions), [decisions]);
  useEffect(() => {
    fetch("/api/impact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decisions: list }) })
      .then((r) => r.json())
      .then(setImp);
  }, [list]);
  const tile = (label: string, value: string, hint: string) => (
    <div className="rounded border border-line bg-surface px-4 py-3" style={{ borderTop: "3px solid var(--accent)" }}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className="tabular mt-1 text-[22px] font-semibold leading-tight">{value}</div>
      <div className="mt-1 text-xs text-muted">{hint}</div>
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile("Decisions taken", imp ? num(imp.approved + imp.rejected) : "…", imp ? `${num(imp.approved)} approved · ${num(imp.rejected)} rejected` : "")}
        {tile("Purchases committed", imp ? idr(imp.orders.value) : "…", imp ? `${num(imp.orders.count)} parts, ${num(imp.orders.critical)} critical (A/B) · ${idr(imp.transfers.valueAvoided)} avoided by ${num(imp.transfers.count)} transfers` : "")}
        {tile("Working capital released", imp ? idr(imp.released.value) : "…", imp ? `${num(imp.released.count)} excess positions approved for reduction` : "")}
        {tile("Downtime risk removed / yr", imp ? idr(imp.riskAvoided) : "…", imp ? `${num(imp.downtimeEventsAvoided, 2)} expected production stops avoided before the next replenishment` : "")}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span>{imp ? `${num(imp.params)} Min–Max updates approved · ${num(imp.insurance)} insurance spares approved` : ""}</span>
        <button onClick={() => { if (confirm("Clear every decision taken in this browser?")) clearAll(); }} className={btn}>
          <RotateCcw size={13} aria-hidden /> Reset demo decisions
        </button>
      </div>
    </div>
  );
}

/** Small live counter of decisions per workspace (used on the start page). */
export function DecisionSummary() {
  const { decisions } = useDecisions();
  const list = Object.values(decisions);
  const n = (k: string) => list.filter((d) => d.kind === k && d.status === "approved").length;
  if (!list.length) return <span className="text-xs text-muted">No decisions taken yet in this browser.</span>;
  return (
    <span className="text-xs text-ink-2">
      Approved so far: {n("reorder")} reorders · {n("transfer")} transfers from identical parts · {n("request")} job-part requests · {n("tam")} turnaround buys · {n("insurance")} insurance spares · {n("param")} Min–Max updates · {n("reduce")} reductions
    </span>
  );
}
