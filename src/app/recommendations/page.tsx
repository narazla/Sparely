import Link from "next/link";
import { Download } from "lucide-react";
import { ActionChip, Card, Chip, CritChip, HealthChip, MaterialLink, PageHeader, SafetyChips, Table, Td, Th, UrgencyChip } from "@/components/ui";
import { getRecommendations } from "@/lib/data";
import { filterRecs, SORTS, TAGS } from "@/lib/filters";
import { date, idr, num, pct, qty } from "@/lib/format";
import { currentParams } from "@/lib/server-params";
import { CRITS } from "@/lib/types";

export const dynamic = "force-dynamic";
const PAGE = 50;
const ACTIONS = ["Reorder", "Transfer", "Reduce", "Monitor", "Maintain"];
const HEALTHS = ["Stockout", "Below reorder point", "Insurance gap", "TAM reserve", "Healthy", "Excess", "Slow-moving", "Non-moving", "Potentially obsolete", "Critical insurance spare", "No stock needed"];

type SP = Promise<Record<string, string | undefined>>;

export default async function Recommendations({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const params = await currentParams();
  const rows = filterRecs(getRecommendations(params), sp);
  const page = Math.max(1, Number(sp.page ?? 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const qs = (extra: Record<string, string | number>) => {
    const u = new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
    return `?${u.toString()}`;
  };
  const totalOrder = rows.reduce((a, r) => a + r.order_value, 0);
  const totalExcess = rows.reduce((a, r) => a + r.excess_value, 0);
  const select = "select";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Analytics" }, { label: "Material List" }]}
        title="Material List"
        subtitle="One decision per spare part: reorder (with quantity and date), reduce, monitor or maintain — with dynamic Safety Stock, Reorder Point (= Min) and Max replacing today's static Min–Max."
      >
        <a href={`/api/recommendations${qs({ format: "csv" })}`} className="btn btn-secondary">
          <Download size={15} aria-hidden /> Export CSV
        </a>
      </PageHeader>

      <form className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3" method="get">
        <label className="text-xs text-muted">Action<br />
          <select name="action" defaultValue={sp.action ?? ""} className={select}>
            <option value="">All</option>
            {ACTIONS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Health<br />
          <select name="health" defaultValue={sp.health ?? ""} className={select}>
            <option value="">All</option>
            {HEALTHS.map((a) => <option key={a}>{a}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Criticality<br />
          <select name="crit" defaultValue={sp.crit ?? ""} className={select}>
            <option value="">All</option>
            <option value="A,B">A + B (critical)</option>
            {CRITS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Flag<br />
          <select name="tag" defaultValue={sp.tag ?? ""} className={select}>
            <option value="">All</option>
            {Object.entries(TAGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted">Sort by<br />
          <select name="sort" defaultValue={sp.sort ?? "priority"} className={select}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="min-w-48 flex-1 text-xs text-muted">Search<br />
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Material no., description or category" className={`${select} w-full`} />
        </label>
        <button className="btn btn-primary">Go</button>
        <Link href="/recommendations" className="btn btn-ghost">Clear filters</Link>
      </form>

      <Card
        title={`${num(rows.length)} spare parts`}
        subtitle={`Order value ${idr(totalOrder)} · excess value ${idr(totalExcess)} · page ${page} of ${pages}`}
      >
        <Table>
          <thead>
            <tr>
              <Th>Part</Th><Th>Crit.</Th><Th>Action</Th><Th>Health</Th>
              <Th right>Stock</Th><Th right>On order</Th><Th right>Today Min / Max</Th>
              <Th right>Rec. SS / Min / Max</Th><Th right>Order</Th><Th right>Stockout risk</Th><Th right>Value</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.material_no} className="hover:bg-surface-2">
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <MaterialLink id={r.material_no} />
                    <SafetyChips sce={r.sce} longLead={r.long_lead} />
                    {r.requires_approval && <span title="Needs Management sign-off"><Chip tone="accent">Sign-off</Chip></span>}
                  </span>
                  <div className="max-w-72 truncate text-xs text-muted" title={r.description}>{r.description}</div>
                </Td>
                <Td><CritChip crit={r.criticality} /></Td>
                <Td><div className="flex flex-col items-start gap-1"><ActionChip action={r.action} /><UrgencyChip urgency={r.urgency} /></div></Td>
                <Td><HealthChip health={r.health} /></Td>
                <Td right>{qty(r.stock)} <span className="text-muted">{r.unit}</span></Td>
                <Td right>{r.on_order ? qty(r.on_order) : "–"}</Td>
                <Td right>{qty(r.current_min)} / {qty(r.current_max)}</Td>
                <Td right>{r.stocked ? `${qty(r.safety_stock)} / ${qty(r.reorder_point)} / ${qty(r.max_level)}` : <span className="text-muted">don&apos;t stock</span>}</Td>
                <Td right>
                  {r.order_qty ? <>{qty(r.order_qty)}<div className="text-xs text-muted">by {date(r.order_by)}</div></> : r.action === "Monitor" && r.order_by ? <span className="text-xs text-muted">reorder ~{date(r.order_by)}</span> : r.transfer_qty ? null : "–"}
                  {r.transfer_qty > 0 && <div className="text-xs text-accent">transfer {qty(r.transfer_qty)} from {r.transfer_from.join(", ")}</div>}
                </Td>
                <Td right>{pct(r.stockout_risk)}</Td>
                <Td right>{r.order_value ? idr(r.order_value) : r.excess_value ? <span className="text-good-ink">−{idr(r.excess_value)}</span> : "–"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs({ page: page - 1 })} className="text-accent hover:underline">← Previous</Link> : <span />}
          <span className="text-muted">Page {page} / {pages}</span>
          {page < pages ? <Link href={qs({ page: page + 1 })} className="text-accent hover:underline">Next →</Link> : <span />}
        </div>
      </Card>
    </>
  );
}
