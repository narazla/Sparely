import type { Crit, Params } from "./types";

export const PARAMS_COOKIE = "caliber_params";

export const DEFAULT_PARAMS: Params = {
  mode: "optimize",
  serviceLevel: { A: 0.99, B: 0.97, C: 0.93, S: 0.85 },
  downtimeCostPerDay: { A: 2_000_000_000, B: 1_000_000_000, C: 250_000_000, S: 50_000_000 },
  holdingRate: 0.2,
  orderCost: 1_500_000,
  emergencyMinDays: 3,
  // short-notice PRs in PR PO were paid the same unit price as normal ones (ratio 1.000)
  emergencyPremium: 0,
  demandFactor: 1,
  leadTimeFactor: 1,
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Merge untrusted input (cookie or request body) onto the defaults, clamping every number. */
export function normalizeParams(input: unknown): Params {
  const p = (input && typeof input === "object" ? input : {}) as Partial<Params>;
  const d = DEFAULT_PARAMS;
  const byCrit = (src: unknown, base: Record<Crit, number>, lo: number, hi: number) => {
    const s = (src && typeof src === "object" ? src : {}) as Partial<Record<Crit, number>>;
    return {
      S: clamp(s.S, lo, hi, base.S),
      A: clamp(s.A, lo, hi, base.A),
      B: clamp(s.B, lo, hi, base.B),
      C: clamp(s.C, lo, hi, base.C),
    };
  };
  return {
    mode: p.mode === "fixed" ? "fixed" : "optimize",
    serviceLevel: byCrit(p.serviceLevel, d.serviceLevel, 0.5, 0.999),
    downtimeCostPerDay: byCrit(p.downtimeCostPerDay, d.downtimeCostPerDay, 0, 1e11),
    holdingRate: clamp(p.holdingRate, 0.01, 1, d.holdingRate),
    orderCost: clamp(p.orderCost, 0, 1e9, d.orderCost),
    emergencyMinDays: clamp(p.emergencyMinDays, 0, 60, d.emergencyMinDays),
    emergencyPremium: clamp(p.emergencyPremium, 0, 3, d.emergencyPremium),
    demandFactor: clamp(p.demandFactor, 0.2, 5, d.demandFactor),
    leadTimeFactor: clamp(p.leadTimeFactor, 0.2, 5, d.leadTimeFactor),
  };
}

export function parseParamsCookie(raw: string | undefined): Params {
  if (!raw) return DEFAULT_PARAMS;
  try {
    return normalizeParams(JSON.parse(decodeURIComponent(raw)));
  } catch {
    return DEFAULT_PARAMS;
  }
}

export function isDefault(p: Params): boolean {
  return JSON.stringify(p) === JSON.stringify(DEFAULT_PARAMS);
}
