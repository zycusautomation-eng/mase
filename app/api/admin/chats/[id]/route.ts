import { NextRequest, NextResponse } from "next/server";
import { callerIsAdmin } from "@/lib/config/server";
import { getChatById } from "@/lib/adminChats/server";

// One chat's full transcript for the admin viewer. Service-role (crosses RLS), admin-gated.
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await callerIsAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { id } = await ctx.params;
  try {
    const chat = await getChatById(id);
    if (!chat) return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    return NextResponse.json(chat);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load chat." }, { status: 500 });
  }
}
