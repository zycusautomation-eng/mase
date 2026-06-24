import { NextRequest, NextResponse } from "next/server";
import { callerEmailIfAdmin, listLists, createList } from "@/lib/sweepLists/server";

// Saved sweep cohorts (Admin -> Run Sweep). Admin-only on every verb — stored in the
// existing app_config table via the service role, so this handler is the real gate.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await callerEmailIfAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  try {
    return NextResponse.json({ lists: await listLists() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const email = await callerEmailIfAdmin();
  if (!email) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const name = String(body?.name ?? "").trim();
  const oppIds = Array.isArray(body?.opp_ids) ? (body.opp_ids as unknown[]).map(String) : [];
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  try {
    return NextResponse.json({ list: await createList(name, oppIds, email) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
