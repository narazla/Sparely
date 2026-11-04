import { ReplayChart } from "./charts";
import { Card, CritChip, MaterialLink, Note, Table, Td, Th } from "./ui";
import { date, idr, num, pct } from "@/lib/format";
import type { ReplayResult } from "@/lib/replay";

/** Evidence block: the hold-out window replayed under both policies. */
export function ReplayCard({ r, compact = false }: { r: ReplayResult; compact?: boolean }) {
  const S = r.staticPolicy;
  const A = r.aiPolicy;
  const change = (a: number, b: number, lowerIsBetter = true) => {
    if (!a) return "–";
    const d = b / a - 1;
    const good = lowerIsBetter ? d < 0 : d > 0;
    return <span className={good ? "text-good-ink" : "text-critical-ink"}>{d > 0 ? "+" : ""}{pct(d)}</span>;
  };
  const rows: [string, string, string, React.ReactNode][] = [
    ["Demand days served in full from stock", pct(S.servedDays / S.demandDays, 1), pct(A.servedDays / A.demandDays, 1), change(S.servedDays / S.demandDays, A.servedDays / A.demandDays, false)],
    ["Units served from stock (fill rate)", pct(S.servedUnits / S.demandUnits, 1), pct(A.servedUnits / A.demandUnits, 1), change(S.servedUnits / S.demandUnits, A.servedUnits / A.demandUnits, false)],
    ["Stockouts (demand day not fully served)", num(S.stockouts), num(A.stockouts), change(S.stockouts, A.stockouts)],
    ["…of which on critical parts (A/B)", num(S.criticalStockouts), num(A.criticalStockouts), change(S.criticalStockouts, A.criticalStockouts)],
    ["Parts that ran out at least once", num(S.partsWithStockout), num(A.partsWithStockout), change(S.partsWithStockout, A.partsWithStockout)],
    ["Average inventory value held", idr(S.avgInventoryValue), idr(A.avgInventoryValue), change(S.avgInventoryValue, A.avgInventoryValue)],
    ["Replenishment bought during the window", idr(S.orderValue), idr(A.orderValue), change(S.orderValue, A.orderValue)],
  ];
  return (
    <Card
      title={`Proof on real demand: ${date(r.start)} – ${date(r.end)} replayed day by day`}
      subtitle="The Sparely policy was computed from data before 1 May 2026 only. Both warehouses then face the same actual issues and lead times."
    >
      <Table>
        <thead><tr><Th>Measure</Th><Th right>Today&apos;s static Min–Max</Th><Th right>Sparely policy</Th><Th right>Change</Th></tr></thead>
        <tbody>
          {rows.map(([m, s, a, c]) => (
            <tr key={m}><Td>{m}</Td><Td right>{s}</Td><Td right className="font-semibold">{a}</Td><Td right>{c}</Td></tr>
          ))}
        </tbody>
      </Table>
      {!compact && (
        <>
          <h3 className="mb-1 mt-5 text-sm font-semibold">Inventory value held each day</h3>
          <ReplayChart data={r.daily} />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Stockouts by criticality</h3>
              <Table>
                <thead><tr><Th>Criticality</Th><Th right>Demand days</Th><Th right>Today</Th><Th right>Sparely</Th></tr></thead>
                <tbody>{r.byCriticality.map((c) => <tr key={c.crit}><Td><CritChip crit={c.crit} /></Td><Td right>{num(c.demandDays)}</Td><Td right>{num(c.staticStockouts)}</Td><Td right>{num(c.aiStockouts)}</Td></tr>)}</tbody>
              </Table>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Largest improvements</h3>
              <Table>
                <thead><tr><Th>Part</Th><Th right>Demand days</Th><Th right>Today</Th><Th right>Sparely</Th></tr></thead>
                <tbody>{r.examples.slice(0, 6).map((e) => (
                  <tr key={e.material_no}><Td><MaterialLink id={e.material_no} /><div className="max-w-56 truncate text-xs text-muted">{e.description}</div></Td><Td right>{num(e.demandDays)}</Td><Td right>{num(e.staticStockouts)}</Td><Td right>{num(e.aiStockouts)}</Td></tr>
                ))}</tbody>
              </Table>
            </div>
          </div>
        </>
      )}
      <Note>
        The Sparely policy buys {S.orderValue ? `${(A.orderValue / S.orderValue).toFixed(1)}×` : "more"} as much during the window, but only for parts that are actually used, while holding {pct(1 - A.avgInventoryValue / S.avgInventoryValue)} less inventory overall.
        It ran out less often on {num(r.better)} parts and more often on {num(r.worse)} — mostly low-criticality parts where the cost model accepts a stockout rather than hold stock.
        Rules: each warehouse starts at its own policy&apos;s Max (Non Stock parts at zero), serves the day&apos;s actual issues, and orders up to Max when on hand + on order reaches Min; orders arrive after the part&apos;s lead time.
        Historical stock levels are not in the data, so the replay compares the two policies from their own starting levels.
      </Note>
    </Card>
  );
}
