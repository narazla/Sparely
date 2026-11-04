import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ScenarioBanner } from "@/components/ScenarioBanner";
import { getMeta } from "@/lib/data";
import { isDefault } from "@/lib/params";
import { currentParams } from "@/lib/server-params";
import { date } from "@/lib/format";

export const metadata: Metadata = {
  title: { default: "Sparely", template: "%s · Sparely" },
  description: "Sparely — AI-powered spare part demand forecasting and dynamic inventory optimization (CALIBER 2026 Final Case).",
  applicationName: "Sparely",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const meta = getMeta();
  const params = await currentParams();
  return (
    <html lang="en">
      <body className="antialiased">
        {/* shell bar */}
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 bg-shell px-3 text-shell-ink md:px-4">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logo, no optimisation needed */}
            <img src="/sparely-logo.png" alt="" width={18} height={28} className="h-7 w-auto" />
            <span className="text-[15px] font-semibold text-white">Sparely</span>
            <span className="hidden h-5 w-px bg-white/25 sm:block" />
            <span className="hidden text-[13px] text-shell-ink/80 sm:block">Spare Parts Planning</span>
          </Link>
          <form action="/recommendations" method="get" className="mx-auto hidden w-full max-w-md md:block">
            <label className="flex h-8 items-center gap-2 rounded-sm bg-white/10 px-2.5 text-[13px] focus-within:bg-white focus-within:text-ink">
              <Search size={14} aria-hidden className="opacity-70" />
              <input name="q" placeholder="Search material number or description" className="w-full bg-transparent outline-none placeholder:text-shell-ink/60" />
            </label>
          </form>
          <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
            <span className="hidden rounded-sm border border-white/20 px-2 py-0.5 lg:inline">Plant 1000</span>
            <span className="hidden text-shell-ink/80 lg:inline">Data as of {date(meta.as_of)}</span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold" title="Demo user (no login in the prototype)">
              DU
            </span>
          </div>
        </header>

        <div className="md:flex">
          <aside className="border-b border-line bg-surface md:sticky md:top-12 md:h-[calc(100vh-3rem)] md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r">
            <div className="px-2 py-2 md:py-3">
              <Nav />
            </div>
            <div className="mx-3 mb-3 hidden border-t border-line pt-3 text-[11px] leading-relaxed text-muted md:block">
              History {date(meta.history_start)} – {date(meta.history_end)}
              <br />
              {Number(meta.materials).toLocaleString("en-US")} materials · {Number(meta.funclocs).toLocaleString("en-US")} FuncLocs
              <br />
              Source: SAP extracts (6 files)
            </div>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-5 md:px-6">
            {!isDefault(params) && <ScenarioBanner />}
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
