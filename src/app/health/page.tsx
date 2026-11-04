import Link from "next/link";
import { HBars } from "@/components/charts";
import { Card, CritChip, HEALTH_STYLE, HealthChip, MaterialLink, Note, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { getMaterials, getRecommendations, identicalGroups, portfolio } from "@/lib/data";
import { idr, num, qty } from "@/lib/format";
import { currentParams } from "@/lib/server-params";
import type { Health } from "@/lib/types";

export const dynamic = "force-dynamic";

const EXPLAIN: Partial<Record<Health, string>> = {
  Excess: "Moving part, but stock is above the recommended Max.",
  "Slow-moving": "Last issued more than 180 days ago.",
  "Non-moving": "Not issued once in 17 months.",
  "Potentially obsolete": "Non-moving, criticality C/S and no planned job in the next 12 months.",
  "Critical insurance spare": "Non-moving but protects A/B equipment and is within the recommended level: keep.",
  "Insurance gap": "Never issued, no stock, but the cost model favours holding some: review with reliability engineering.",
  "TAM reserve": "Used only in the last turnaround: kept for the next one instead of being reduced as slow-moving.",
};

export default async function HealthPage() {
  const params = await currentParams();
  const pf = portfolio(params);
  const recs = getRecommendations(params);
  const mats = getMaterials();

  const aging = [
    { label: "Issued ≤ 90 days ago", test: (d: number | null) => d != null && d <= 90 },
    { label: "91 – 180 days", test: (d: number | null) => d != null && d > 90 && d <= 180 },
    { label: "181 – 365 days", test: (d: number | null) => d != null && d > 180 && d <= 365 },
    { label: "> 365 days", test: (d: number | null) => d != null && d > 365 },
    { label: "Never issued (17 months)", test: (d: number | null) => d == null },
  ].map((b) => {
    let count = 0, value = 0;
    recs.forEach((r, i) => {
      if (r.stock > 0 && b.test(mats[i].days_since_last_issue)) {
        count++;
        value += r.stock * r.price;
      }
    });
    return { label: b.label, count, value };
  });

  const uncontrolled = recs.filter((r) => r.mrp_type === "Non Stock" && r.stock > 0);
  const groups = identicalGroups(params);
  const paradox = groups.filter((g) => g.paradox).length;
  const watch: Health[] = ["Potentially obsolete", "Non-moving", "Slow-moving", "Excess"];

  return (
    <>
      <PageHeader crumbs={[{ label: "Analytics" }, { label: "Inventory Health" }]} title="Inventory Health Monitoring" subtitle="Detects excess, slow-moving, non-moving and potentially obsolete spare parts — and separates them from critical insurance spares that must be kept." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {watch.map((h) => {
          const x = pf.health.find((s) => s.status === h);
          return <Stat key={h} label={h} value={idr(x?.value ?? 0)} hint={`${num(x?.count ?? 0)} parts · ${EXPLAIN[h]}`} />;
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Stock value by health status" subtitle="Current stock × unit price">
          <HBars data={pf.health.filter((h) => h.value > 0).map((h) => ({ label: h.status, value: h.value }))} format="idr" />
        </Card>
        <Card title="Stock value by time since last issue" subtitle="Parts with stock on hand">
          <HBars data={aging.map((a) => ({ label: a.label, value: a.value }))} format="idr" />
          <Note>{num(aging[4].count)} parts holding stock were never issued in the 17-month history.</Note>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {pf.health.map((h) => (
          <Link key={h.status} href={`/recommendations?health=${encodeURIComponent(h.status)}&sort=stock_value`} className="rounded-xl border border-line bg-surface p-4 hover:bg-surface-2">
            <HealthChip health={h.status} />
            <div className="mt-2 text-lg font-semibold">{num(h.count)} parts</div>
            <div className="text-xs text-muted">{idr(h.value)} · {EXPLAIN[h.status] ?? HEALTH_STYLE[h.status][0]}</div>
          </Link>
        ))}
      </div>

      <Card
        title="Same part, different material number"
        subtitle={`${num(groups.length)} groups of material numbers share an identical description and unit (${num(groups.reduce((a, g) => a + g.members.length, 0))} numbers). In ${num(paradox)} groups one number is at zero stock while another holds stock — the "needed part is out, the same part sits on the shelf" problem.`}
        className="mt-4"
      >
        <Table>
          <thead><tr><Th>Item</Th><Th>Numbers (stock · times issued in 17 months)</Th><Th right>Stock value</Th><Th right>Transfer</Th></tr></thead>
          <tbody>
            {groups.slice(0, 10).map((g) => (
              <tr key={g.description + g.unit}>
                <Td className="max-w-64">{g.description}<div className="text-xs text-muted">{g.unit}{g.paradox ? " · one empty, one stocked" : ""}</div></Td>
                <Td className="text-xs">
                  {g.members.slice(0, 5).map((m) => (
                    <div key={m.material_no}><MaterialLink id={m.material_no} /> · stock {qty(m.stock)} · issued {num(m.issueLines)}×{m.transfer_qty > 0 && <span className="text-accent"> · receives {qty(m.transfer_qty)}</span>}</div>
                  ))}
                  {g.members.length > 5 && <div className="text-muted">+{g.members.length - 5} more</div>}
                </Td>
                <Td right>{idr(g.stockValue)}</Td>
                <Td right>{g.transferUnits > 0 ? `${qty(g.transferUnits)} units` : "–"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Note>
          Before buying, Sparely uses spare stock held under an identical number (above that number&apos;s own reorder point): {num(pf.transfer.parts)} needs covered, {idr(pf.transfer.valueAvoided)} not bought.
          Identical text does not always mean an interchangeable part (brand, drawing revision), so every transfer is a proposal for the planner, and the groups are candidates for merging in the material master.
        </Note>
      </Card>

      <Card title="Uncontrolled stock" subtitle="Parts set as Non Stock (Min = Max = 0) that still hold stock" className="mt-4">
        <p className="mb-3 text-sm text-ink-2">
          {num(uncontrolled.length)} parts worth {idr(uncontrolled.reduce((a, r) => a + r.stock * r.price, 0))}. Static Min–Max cannot see them; Sparely assigns each a policy.
        </p>
        <Table>
          <thead><tr><Th>Part</Th><Th>Crit.</Th><Th right>Stock</Th><Th right>Value</Th><Th>Health</Th><Th>Sparely policy</Th></tr></thead>
          <tbody>
            {uncontrolled.sort((a, b) => b.stock * b.price - a.stock * a.price).slice(0, 12).map((r) => (
              <tr key={r.material_no}>
                <Td><MaterialLink id={r.material_no} /><div className="text-xs text-muted">{r.description.slice(0, 48)}</div></Td>
                <Td><CritChip crit={r.criticality} /></Td>
                <Td right>{qty(r.stock)}</Td>
                <Td right>{idr(r.stock * r.price)}</Td>
                <Td><HealthChip health={r.health} /></Td>
                <Td>{r.stocked ? `Stock Item: Min ${qty(r.reorder_point)}, Max ${qty(r.max_level)}` : "Keep Non Stock, run down stock"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
