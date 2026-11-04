import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowDownCircle,
  ArrowLeftRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Eye,
  Hourglass,
  Info,
  PackageX,
  ShieldCheck,
  ShoppingCart,
  Snail,
  type LucideIcon,
} from "lucide-react";
import { isCritical, type Action, type Crit, type Health } from "@/lib/types";

export type Crumb = { label: string; href?: string };

/** Page title bar: breadcrumb, title, one-line description, actions on the right. */
export function PageHeader({ title, subtitle, crumbs, children }: { title: string; subtitle?: string; crumbs?: Crumb[]; children?: React.ReactNode }) {
  const trail: Crumb[] = [{ label: "Home", href: "/" }, ...(crumbs ?? [])];
  return (
    <div className="-mx-4 -mt-5 mb-5 border-b border-line bg-surface px-4 pb-4 pt-3 md:-mx-6 md:px-6">
      <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-muted">
        {trail.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} aria-hidden />}
            {c.href ? <Link href={c.href} className="hover:text-accent hover:underline">{c.label}</Link> : <span>{c.label}</span>}
          </span>
        ))}
      </nav>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-4xl text-[13px] text-ink-2">{subtitle}</p>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
      </div>
    </div>
  );
}

/** Panel with a header bar. */
export function Card({ title, subtitle, children, className = "", action }: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`rounded border border-line bg-surface ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 pt-0.5">{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** KPI tile. */
export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: React.ReactNode; tone?: "good" | "critical" }) {
  const bar = tone === "good" ? "var(--good)" : tone === "critical" ? "var(--critical)" : "var(--accent)";
  return (
    <div className="rounded border border-line bg-surface px-4 py-3" style={{ borderTop: `3px solid ${bar}` }}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className={`tabular mt-1 text-[22px] font-semibold leading-tight ${tone === "good" ? "text-good-ink" : tone === "critical" ? "text-critical-ink" : "text-ink"}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[11.5px] leading-snug text-muted">{hint}</div>}
    </div>
  );
}

type Tone = "critical" | "serious" | "warning" | "good" | "neutral" | "accent";
const TONE: Record<Tone, { bg: string; fg: string; bd: string }> = {
  critical: { bg: "#fdeaea", fg: "#a20000", bd: "#f3c4c4" },
  serious: { bg: "#fef1e6", fg: "#9a4a00", bd: "#f5cfa8" },
  warning: { bg: "#fff8e1", fg: "#7a5a00", bd: "#f0d98a" },
  good: { bg: "#eaf5ee", fg: "#0d6630", bd: "#b9dcc6" },
  neutral: { bg: "#eef1f4", fg: "#475e75", bd: "#d5dce3" },
  accent: { bg: "#e8f2fc", fg: "#0854a0", bd: "#bcd8f5" },
};

/** Object status badge: icon + label, never colour alone. */
export function Chip({ tone, icon: Icon, children }: { tone: Tone; icon?: LucideIcon; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-px text-[11.5px] font-semibold"
      style={{ background: t.bg, color: t.fg, borderColor: t.bd }}
    >
      {Icon && <Icon size={12} strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}

const ACTION_STYLE: Record<Action, [Tone, LucideIcon]> = {
  Reorder: ["critical", ShoppingCart],
  Transfer: ["accent", ArrowLeftRight],
  Reduce: ["serious", ArrowDownCircle],
  Monitor: ["warning", Eye],
  Maintain: ["good", CheckCircle2],
};

export function ActionChip({ action }: { action: Action }) {
  const [tone, icon] = ACTION_STYLE[action];
  return <Chip tone={tone} icon={icon}>{action}</Chip>;
}

export const HEALTH_STYLE: Record<Health, [Tone, LucideIcon]> = {
  Stockout: ["critical", PackageX],
  "Below reorder point": ["serious", AlertTriangle],
  "Insurance gap": ["warning", Info],
  Healthy: ["good", CheckCircle2],
  Excess: ["serious", ArrowDownCircle],
  "Slow-moving": ["warning", Snail],
  "Non-moving": ["serious", Hourglass],
  "Potentially obsolete": ["critical", AlertOctagon],
  "Critical insurance spare": ["accent", ShieldCheck],
  "TAM reserve": ["accent", CalendarClock],
  "No stock needed": ["neutral", CheckCircle2],
};

export function HealthChip({ health }: { health: Health }) {
  const [tone, icon] = HEALTH_STYLE[health];
  return <Chip tone={tone} icon={icon}>{health}</Chip>;
}

export function CritChip({ crit }: { crit: Crit }) {
  const strong = isCritical(crit);
  return (
    <span
      title={`Equipment criticality ${crit} (A highest, S lowest)`}
      className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-sm px-1 text-[11px] font-bold ${strong ? "bg-ink text-white" : "border border-axis bg-surface text-ink-2"}`}
      style={strong ? undefined : { borderColor: "var(--axis)" }}
    >
      {crit}
    </span>
  );
}

export function UrgencyChip({ urgency }: { urgency: "Critical" | "High" | "Normal" | null }) {
  if (!urgency) return null;
  const tone: Tone = urgency === "Critical" ? "critical" : urgency === "High" ? "serious" : "neutral";
  return <Chip tone={tone}>{urgency}</Chip>;
}

export function MaterialLink({ id, children }: { id: number; children?: React.ReactNode }) {
  return (
    <Link href={`/materials/${id}`} className="tabular font-semibold text-accent hover:underline">
      {children ?? id}
    </Link>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="dtable w-full min-w-[560px] border-collapse text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return <th className={right ? "text-right" : "text-left"}>{children}</th>;
}

export function Td({ children, right, className = "" }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`text-ink ${right ? "tabular text-right" : ""} ${className}`}>{children}</td>;
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex gap-1.5 text-xs leading-relaxed text-muted">
      <Info size={13} className="mt-px shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
