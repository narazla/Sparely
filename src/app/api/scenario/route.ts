import { NextResponse } from "next/server";
import { frontier, portfolio } from "@/lib/data";
import { normalizeParams } from "@/lib/params";
import { replay } from "@/lib/replay";

export const dynamic = "force-dynamic";

/** POST { params } -> portfolio KPIs + efficient frontier for that cost–risk scenario. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const params = normalizeParams(body?.params);
  const t0 = Date.now();
  const pf = portfolio(params);
  const fr = frontier(params);
  const { staticPolicy, aiPolicy } = replay(params);
  return NextResponse.json({ params, portfolio: pf, frontier: fr, replay: { staticPolicy, aiPolicy }, computeMs: Date.now() - t0 });
}
