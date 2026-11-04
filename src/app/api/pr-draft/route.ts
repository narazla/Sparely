import { NextResponse } from "next/server";
import { prDraft } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/** POST { items: [{ material_no, qty, need_by?, source? }] } -> purchase-requisition lines */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items.slice(0, 2000) : [];
  const clean = items
    .map((i: Record<string, unknown>) => ({
      material_no: Number(i.material_no),
      qty: Number(i.qty),
      need_by: typeof i.need_by === "string" && /^\d{4}-\d{2}-\d{2}$/.test(i.need_by) ? i.need_by : undefined,
      source: typeof i.source === "string" ? i.source.slice(0, 40) : undefined,
    }))
    .filter((i: { material_no: number; qty: number }) => Number.isFinite(i.material_no) && Number.isFinite(i.qty));
  return NextResponse.json({ lines: prDraft(clean) });
}
