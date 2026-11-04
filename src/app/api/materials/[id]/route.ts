import { NextResponse } from "next/server";
import { materialDetail } from "@/lib/data";
import { currentParams } from "@/lib/server-params";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = materialDetail(Number(id), await currentParams());
  if (!d) return NextResponse.json({ error: "material not found" }, { status: 404 });
  return NextResponse.json(d);
}
