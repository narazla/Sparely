import { NextResponse } from "next/server";
import { getMeta, portfolio } from "@/lib/data";
import { currentParams } from "@/lib/server-params";

export const dynamic = "force-dynamic";

export async function GET() {
  const params = await currentParams();
  return NextResponse.json({ meta: getMeta(), params, portfolio: portfolio(params) });
}
