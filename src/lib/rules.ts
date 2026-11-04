/**
 * Safety and governance rules. These are company policy, not cost–risk scenarios,
 * so they are fixed here (and listed on the Data & Method page) instead of being sliders.
 * Safe to import from client components.
 */

/**
 * FuncLoc tags that mark a safety-critical element (SCE): pressure relief (safety) valves
 * and shutdown valves. In a live plant the SCE register replaces this tag rule.
 */
export const SCE_TAGS = ["PRV-", "SDV-"];

/** SQL condition on material_funcloc.funcloc that selects safety-critical locations. */
export const SCE_FUNCLOC_SQL = SCE_TAGS.map((t) => `funcloc LIKE '%${t}%'`).join(" OR ");

/** Spare units a safety-critical part always keeps, whatever its demand. */
export const SCE_MIN_SPARE = 1;

/** Critical parts whose observed 80th-percentile lead time exceeds this are flagged long-lead. */
export const LONG_LEAD_DAYS = 90;

/** Buys and reductions above this value (IDR) need Management sign-off; so does any reduction of a safety-critical part. */
export const APPROVAL_LIMIT_IDR = 1_000_000_000;

/** Does a decision need Management sign-off before it takes effect (PR draft, Min–Max file, released capital)? */
export function needsSignoff(kind: string, value: number, sce: boolean): boolean {
  if (kind === "reduce") return sce || value > APPROVAL_LIMIT_IDR;
  if (kind === "reorder" || kind === "request" || kind === "tam" || kind === "insurance") return value > APPROVAL_LIMIT_IDR;
  return false;
}
