"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  Database,
  Factory,
  FlaskConical,
  HeartPulse,
  Home,
  LineChart,
  ListChecks,
  ShoppingBag,
  Wrench,
} from "lucide-react";

const GROUPS = [
  { title: null, links: [{ href: "/", label: "Home", icon: Home }] },
  {
    title: "Workspaces",
    links: [
      { href: "/workspace/maintenance", label: "Maintenance", icon: Wrench },
      { href: "/workspace/planner", label: "Inventory Planner", icon: ClipboardCheck },
      { href: "/workspace/procurement", label: "Procurement", icon: ShoppingBag },
      { href: "/workspace/management", label: "Management", icon: Factory },
    ],
  },
  {
    title: "Analytics",
    links: [
      { href: "/recommendations", label: "Material List", icon: ListChecks },
      { href: "/health", label: "Inventory Health", icon: HeartPulse },
      { href: "/forecast", label: "Demand Forecast", icon: LineChart },
      { href: "/scenario", label: "Cost–Risk Scenarios", icon: FlaskConical },
      { href: "/data", label: "Data & Method", icon: Database },
    ],
  },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href) || (href === "/recommendations" && path.startsWith("/materials"));
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col md:gap-3 md:overflow-visible">
      {GROUPS.map((g) => (
        <div key={g.title ?? "home"} className="flex shrink-0 gap-0.5 md:flex-col">
          {g.title && <div className="hidden px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted md:block">{g.title}</div>}
          {g.links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex shrink-0 items-center gap-2.5 border-l-[3px] px-2.5 py-1.5 text-[13px] ${
                active(href)
                  ? "border-accent bg-accent-soft font-semibold text-accent-ink"
                  : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <Icon size={15} aria-hidden />
              {label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
