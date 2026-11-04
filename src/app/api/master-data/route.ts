import { NextResponse } from "next/server";
import { currentParams } from "@/lib/server-params";
import { masterDataWorklist } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/** GET ?format=csv -> master-data work list (candidates for the SAP master-data team) */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const md = masterDataWorklist(await currentParams());
  if (sp.get("format") === "csv") {
    const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const csv = [
      ["issue", "material_no", "description", "detail", "suggested_sap_action", "stock_value_idr"].join(","),
      ...md.rows.map((r) => [r.issue, r.material_no, r.description, r.detail, r.sap_action, Math.round(r.value)].map(esc).join(",")),
    ].join("\n");
    return new NextResponse(csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="sparely-master-data-worklist.csv"' },
    });
  }
  return NextResponse.json({ summary: md.summary, groups: md.groups, emptyWhileTwinHolds: md.emptyWhileTwinHolds, rows: md.rows.length });
}
