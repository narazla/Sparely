import { NextResponse } from "next/server";
import { replay } from "@/lib/replay";
import { currentParams } from "@/lib/server-params";

export const dynamic = "force-dynamic";

/** GET -> day-by-day replay of May–Sep 2026 under today's Min–Max vs the Sparely policy (active scenario). */
export async function GET() {
  const t0 = Date.now();
  const r = replay(await currentParams());
  return NextResponse.json({ ...r, computeMs: Date.now() - t0 });
}
