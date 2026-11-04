import { NextResponse } from "next/server";
import { getRecommendations } from "@/lib/data";
import { filterRecs, toCsv } from "@/lib/filters";
import { currentParams } from "@/lib/server-params";

export const dynamic = "force-dynamic";

/** GET ?action=&health=&crit=A,B&q=&sort=&limit=&format=csv */
export async function GET(req: Request) {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const rows = filterRecs(getRecommendations(await currentParams()), sp);
  if (sp.format === "csv") {
    return new NextResponse(toCsv(rows), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sparely-recommendations.csv"' },
    });
  }
  const limit = Math.min(1000, Math.max(1, Number(sp.limit ?? 100)));
  return NextResponse.json({ total: rows.length, items: rows.slice(0, limit) });
}
