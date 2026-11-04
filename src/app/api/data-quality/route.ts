import { NextResponse } from "next/server";
import { assumptions, dataQuality, downtimeProbabilities, getImpact, getMeta, tableCounts } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    meta: getMeta(),
    tables: tableCounts(),
    checks: dataQuality(),
    assumptions: assumptions(),
    downtimeCalibration: { ...getImpact(), probabilities: downtimeProbabilities() },
  });
}
