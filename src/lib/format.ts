/** Compact rupiah: Rp 5.81T, Rp 223.1B, Rp 12.3M, Rp 81,432 */
export function idr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (a >= 1e12) return `${sign}Rp ${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${sign}Rp ${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}Rp ${(a / 1e6).toFixed(1)}M`;
  return `${sign}Rp ${Math.round(a).toLocaleString("en-US")}`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return v.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return num(v, a >= 100 ? 0 : a >= 10 ? 1 : 2);
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${(v * 100).toFixed(digits)}%`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function month(ym: string): string {
  const d = new Date(ym + "-01T00:00:00Z");
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}
