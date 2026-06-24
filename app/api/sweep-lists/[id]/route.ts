import { NextRequest, NextResponse } from "next/server";
import { callerEmailIfAdmin, updateList, deleteList } from "@/lib/sweepLists/server";

// Update (rename / change members) or delete one saved sweep list. Admin-only.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await callerEmailIfAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { id } = await ctx.params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const patch: { name?: string; opp_ids?: string[] } = {};
  if (typeof body?.name === "string") patch.name = body.name.trim();
  if (Array.isArray(body?.opp_ids)) patch.opp_ids = (body.opp_ids as unknown[]).map(String);
  if (patch.name === undefined && patch.opp_ids === undefined)
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  try {
    return NextResponse.json({ list: await updateList(id, patch) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await callerEmailIfAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    await deleteList(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
