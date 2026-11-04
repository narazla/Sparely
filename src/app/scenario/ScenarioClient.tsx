"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { FrontierChart } from "@/components/charts";
import { clearScenarioCookie } from "@/components/ScenarioBanner";
import { idr, num, pct } from "@/lib/format";
import { PARAMS_COOKIE } from "@/lib/params";
import type { Portfolio } from "@/lib/data";
import type { Crit, Params } from "@/lib/types";

type FrontierPoint = { serviceLevel: number; inventoryValue: number; riskCost: number; holdingCost: number; stockouts: number; downtimeEvents: number };
type Replayed = { stockouts: number; criticalStockouts: number; servedDays: number; demandDays: number; avgInventoryValue: number };
type Result = { portfolio: Portfolio; frontier: FrontierPoint[]; replay: { staticPolicy: Replayed; aiPolicy: Replayed } };
const CR: Crit[] = ["A", "B", "C", "S"];

const PRESETS: { name: string; text: string; make: (d: Params) => Params }[] = [
  { name: "Balanced (default)", text: "Assumptions as documented", make: (d) => d },
  { name: "Lean working capital", text: "Capital costs 35%/yr, downtime valued at half", make: (d) => ({ ...d, holdingRate: 0.35, downtimeCostPerDay: scale(d.downtimeCostPerDay, 0.5) }) },
  { name: "Maximum availability", text: "Downtime valued 3× higher", make: (d) => ({ ...d, downtimeCostPerDay: scale(d.downtimeCostPerDay, 3) }) },
  { name: "Supply disruption", text: "All lead times +50%", make: (d) => ({ ...d, leadTimeFactor: 1.5 }) },
  { name: "Demand surge", text: "Demand +30% (e.g. ageing equipment)", make: (d) => ({ ...d, demandFactor: 1.3 }) },
  { name: "Fixed service levels", text: "A 99%, B 97%, C 93%, S 85%", make: (d) => ({ ...d, mode: "fixed" }) },
];

function scale(r: Record<Crit, number>, k: number): Record<Crit, number> {
  return { S: r.S * k, A: r.A * k, B: r.B * k, C: r.C * k };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-2">
      <span className="font-medium text-ink">{label}</span>
      {hint && <span className="ml-1 text-muted">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Compare({ label, today, scenario, fmt, lowerIsBetter = true }: { label: string; today: number; scenario: number; fmt: (v: number) => string; lowerIsBetter?: boolean }) {
  const delta = today ? scenario / today - 1 : 0;
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs font-medium text-ink-2">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{fmt(scenario)}</span>
        {today !== 0 && (
          <span className={`text-xs font-medium ${good ? "text-good-ink" : "text-critical-ink"}`}>
            {delta > 0 ? "+" : ""}{pct(delta, 0)}
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-muted">Today&apos;s static Min–Max: {fmt(today)}</div>
    </div>
  );
}

export function ScenarioClient({ initialParams, defaults, initial, downtimeProb, emergenciesPerYear }: {
  initialParams: Params;
  defaults: Params;
  initial: Result;
  downtimeProb: { crit: Crit; prob: number }[];
  emergenciesPerYear: number;
}) {
  const router = useRouter();
  const [p, setP] = useState<Params>(initialParams);
  const [res, setRes] = useState<Result>(initial);
  const [loading, setLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [, startTransition] = useTransition();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/scenario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ params: p }), signal: ctl.signal });
        if (r.ok) setRes(await r.json());
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 350);
    setApplied(false);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [p]);

  const pf = res.portfolio;
  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((x) => ({ ...x, [k]: v }));
  const setCrit = (k: "serviceLevel" | "downtimeCostPerDay", c: Crit, v: number) => setP((x) => ({ ...x, [k]: { ...x[k], [c]: v } }));
  const input = "input w-full tabular";

  const apply = () => {
    document.cookie = `${PARAMS_COOKIE}=${encodeURIComponent(JSON.stringify(p))}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=lax`;
    setApplied(true);
    startTransition(() => router.refresh());
  };
  const reset = () => {
    clearScenarioCookie();
    setP(defaults);
    startTransition(() => router.refresh());
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Scenario presets</h2>
          <div className="grid gap-1.5">
            {PRESETS.map((s) => (
              <button key={s.name} onClick={() => setP(s.make(defaults))} className="rounded-lg border border-line px-3 py-2 text-left hover:bg-surface-2">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted">{s.text}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-semibold">Parameters</h2>
          <Field label="Policy mode">
            <select className={input} value={p.mode} onChange={(e) => set("mode", e.target.value as Params["mode"])}>
              <option value="optimize">Optimized per material (cost–risk)</option>
              <option value="fixed">Fixed service level by criticality</option>
            </select>
          </Field>
          {p.mode === "fixed" && (
            <div className="grid grid-cols-4 gap-2">
              {CR.map((c) => (
                <Field key={c} label={`SL ${c}`}>
                  <input type="number" step={0.005} min={0.5} max={0.999} className={input} value={p.serviceLevel[c]} onChange={(e) => setCrit("serviceLevel", c, Number(e.target.value))} />
                </Field>
              ))}
            </div>
          )}
          <div>
            <div className="text-xs font-medium text-ink">Production loss per downtime day (Rp billion)</div>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {CR.map((c) => (
                <Field key={c} label={c}>
                  <input type="number" step={0.05} min={0} className={input} value={+(p.downtimeCostPerDay[c] / 1e9).toFixed(3)} onChange={(e) => setCrit("downtimeCostPerDay", c, Number(e.target.value) * 1e9)} />
                </Field>
              ))}
            </div>
          </div>
          <Field label="Holding cost" hint={`${pct(p.holdingRate)} of value / yr`}>
            <input type="range" min={0.05} max={0.5} step={0.01} value={p.holdingRate} onChange={(e) => set("holdingRate", Number(e.target.value))} className="w-full" />
          </Field>
          <Field label="Demand level" hint={`× ${p.demandFactor.toFixed(2)}`}>
            <input type="range" min={0.5} max={2} step={0.05} value={p.demandFactor} onChange={(e) => set("demandFactor", Number(e.target.value))} className="w-full" />
          </Field>
          <Field label="Lead time" hint={`× ${p.leadTimeFactor.toFixed(2)}`}>
            <input type="range" min={0.5} max={2.5} step={0.05} value={p.leadTimeFactor} onChange={(e) => set("leadTimeFactor", Number(e.target.value))} className="w-full" />
          </Field>
          <Field label="Emergency purchase premium" hint={pct(p.emergencyPremium)}>
            <input type="range" min={0} max={1} step={0.05} value={p.emergencyPremium} onChange={(e) => set("emergencyPremium", Number(e.target.value))} className="w-full" />
          </Field>
          <Field label="Cost per purchase order (Rp)">
            <input type="number" step={100000} min={0} className={input} value={p.orderCost} onChange={(e) => set("orderCost", Number(e.target.value))} />
          </Field>
          <div className="flex gap-2 pt-1">
            <button onClick={apply} className="btn btn-primary flex-1 justify-center">
              <Check size={15} aria-hidden /> {applied ? "Applied to all views" : "Apply to all views"}
            </button>
            <button onClick={reset} className="btn btn-secondary">
              <RotateCcw size={14} aria-hidden /> Reset
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed text-ink-2">
          <h2 className="mb-1 text-sm font-semibold text-ink">Calibrated from data</h2>
          Probability that one stockout actually stops production, calibrated so today&apos;s Min–Max reproduces the{" "}
          <b className="text-ink">{num(emergenciesPerYear, 0)}</b> emergency notifications per year in Notif History:
          <div className="mt-2 grid grid-cols-4 gap-2 text-center">
            {downtimeProb.map((d) => (
              <div key={d.crit} className="rounded-md bg-surface-2 py-1.5">
                <div className="text-muted">{d.crit}</div>
                <div className="tabular font-semibold text-ink">{pct(d.prob, 2)}</div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs text-muted">
          {loading ? <><Loader2 size={14} className="animate-spin" aria-hidden /> Re-optimizing {num(pf.materials)} spare parts…</> : <>Optimized {num(pf.materials)} spare parts</>}
        </div>
        <section className="rounded-xl border border-line bg-accent-soft p-4">
          <h2 className="text-sm font-semibold">Replayed on real demand (May–Sep 2026) under this scenario</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            {[
              ["Stockouts", num(res.replay.staticPolicy.stockouts), num(res.replay.aiPolicy.stockouts)],
              ["On critical parts", num(res.replay.staticPolicy.criticalStockouts), num(res.replay.aiPolicy.criticalStockouts)],
              ["Demand days served", pct(res.replay.staticPolicy.servedDays / res.replay.staticPolicy.demandDays, 1), pct(res.replay.aiPolicy.servedDays / res.replay.aiPolicy.demandDays, 1)],
              ["Avg inventory held", idr(res.replay.staticPolicy.avgInventoryValue), idr(res.replay.aiPolicy.avgInventoryValue)],
            ].map(([l, s, a]) => (
              <div key={l}>
                <div className="text-xs text-ink-2">{l}</div>
                <div className="tabular"><span className="text-muted">{s}</span> → <b>{a}</b></div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Today&apos;s static Min–Max → Sparely policy for this scenario. The cards below are the cost model&apos;s annual expectation.</p>
        </section>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          <Compare label="Average inventory value" today={pf.currentStockValue} scenario={pf.targetInventoryValue} fmt={idr} />
          <Compare label="Holding cost / yr" today={pf.current.holding} scenario={pf.recommended.holding} fmt={idr} />
          <Compare label="Expected downtime-risk cost / yr" today={pf.current.risk} scenario={pf.recommended.risk} fmt={idr} />
          <Compare label="Downtime events from stockouts / yr" today={pf.current.downtimeEvents} scenario={pf.recommended.downtimeEvents} fmt={(v) => num(v, 1)} />
          <Compare label="Stockouts / yr (all parts)" today={pf.current.stockouts} scenario={pf.recommended.stockouts} fmt={(v) => num(v, 0)} />
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="text-xs font-medium text-ink-2">Actions in this scenario</div>
            <div className="mt-1 text-sm">
              <b>{num(pf.actions.Reorder)}</b> reorder ({idr(pf.reorderValue)}) · <b>{num(pf.actions.Reduce)}</b> reduce ({idr(pf.excessValue)})
            </div>
            <div className="mt-1 text-xs text-muted">{num(pf.criticalAtRisk)} critical parts with ≥50% stockout risk before replenishment</div>
          </div>
        </div>
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold">Trade-off: inventory investment vs downtime risk</h2>
          <p className="mb-2 mt-0.5 text-xs text-muted">
            Blue line: every stocked part held at the same service level (80% → 99.9%). Moving right buys availability with working capital. The Sparely point optimizes each part separately, so it reaches the same risk with less inventory.
            Today&apos;s static Min–Max ({idr(pf.currentStockValue)} inventory, {idr(pf.current.risk)} risk / yr) is far off this chart — see the first row below.
          </p>
          <FrontierChart points={res.frontier} optimized={{ inventoryValue: pf.targetInventoryValue, riskCost: pf.recommended.risk }} />
          <div className="-mx-5 mt-2 overflow-x-auto px-5">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="text-muted"><th className="py-1 text-left font-medium">Service level</th><th className="text-right font-medium">Avg inventory</th><th className="text-right font-medium">Holding / yr</th><th className="text-right font-medium">Risk / yr</th><th className="text-right font-medium">Downtime events / yr</th></tr>
              </thead>
              <tbody className="tabular">
                <tr className="border-t border-line font-medium">
                  <td className="py-1">Today&apos;s static Min–Max</td>
                  <td className="text-right">{idr(pf.currentStockValue)}</td>
                  <td className="text-right">{idr(pf.current.holding)}</td>
                  <td className="text-right">{idr(pf.current.risk)}</td>
                  <td className="text-right">{num(pf.current.downtimeEvents, 1)}</td>
                </tr>
                <tr className="border-t border-line font-medium text-good-ink">
                  <td className="py-1">Sparely optimized</td>
                  <td className="text-right">{idr(pf.targetInventoryValue)}</td>
                  <td className="text-right">{idr(pf.recommended.holding)}</td>
                  <td className="text-right">{idr(pf.recommended.risk)}</td>
                  <td className="text-right">{num(pf.recommended.downtimeEvents, 1)}</td>
                </tr>
                {res.frontier.map((f) => (
                  <tr key={f.serviceLevel} className="border-t border-line">
                    <td className="py-1">{pct(f.serviceLevel, 1)}</td>
                    <td className="text-right">{idr(f.inventoryValue)}</td>
                    <td className="text-right">{idr(f.holdingCost)}</td>
                    <td className="text-right">{idr(f.riskCost)}</td>
                    <td className="text-right">{num(f.downtimeEvents, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
