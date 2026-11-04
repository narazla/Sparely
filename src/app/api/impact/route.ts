import { NextResponse } from "next/server";
import { currentParams } from "@/lib/server-params";
import { decisionImpact, type Decision } from "@/lib/workflow";

export const dynamic = "force-dynamic";

const KINDS = new Set(["reorder", "transfer", "request", "tam", "param", "reduce", "insurance"]);

/** POST { decisions: Decision[] } -> committed spend, capital released, downtime risk removed */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const list: Decision[] = (Array.isArray(body?.decisions) ? body.decisions : [])
    .slice(0, 5000)
    .filter((d: Decision) => d && KINDS.has(d.kind) && Number.isFinite(Number(d.material_no)) && (d.status === "approved" || d.status === "rejected"))
    .map((d: Decision) => ({ ...d, material_no: Number(d.material_no), qty: d.qty != null ? Number(d.qty) : undefined }));
  return NextResponse.json(decisionImpact(list, await currentParams()));
}
