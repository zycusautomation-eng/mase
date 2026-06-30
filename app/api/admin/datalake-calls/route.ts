import { NextRequest, NextResponse } from "next/server";
import { callerIsAdmin } from "@/lib/config/server";
import { queryMeetings, datalakeConfigured } from "@/lib/datalake/server";

// Admin-only datalake call explorer: filter Avoma meetings by date range + opp.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  if (!datalakeConfigured()) {
    return NextResponse.json(
      { error: "Datalake isn't configured on the server. Add DATALAKE_URL and DATALAKE_SERVICE_KEY to the environment." },
      { status: 500 }
    );
  }
  const sp = req.nextUrl.searchParams;
  try {
    const rows = await queryMeetings({
      from: sp.get("from") || "",
      to: sp.get("to") || "",
      oppId: sp.get("opp_id") || "",
      subject: sp.get("subject") || "",
      includeInternal: sp.get("internal") === "1",
      includeCancelled: sp.get("cancelled") === "1",
      limit: Number(sp.get("limit") || 500),
    });
    return NextResponse.json({ rows, count: rows.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
