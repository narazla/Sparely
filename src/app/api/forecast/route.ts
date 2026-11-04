import { NextResponse } from "next/server";
import { backtest, demandClasses, forecastAggregate, forecastMethods, plannedSummary } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    monthly: forecastAggregate(),
    demandClasses: demandClasses(),
    methods: forecastMethods(),
    backtest: backtest(),
    plannedDemand: plannedSummary(),
  });
}
