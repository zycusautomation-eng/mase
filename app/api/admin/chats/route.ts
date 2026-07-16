import { NextResponse } from "next/server";
import { callerIsAdmin } from "@/lib/config/server";
import { listAllChats } from "@/lib/adminChats/server";

// Admin → Chats: every user's saved conversations (RevOps chat + per-deal chats),
// grouped by user. Service-role read (crosses RLS); admin-gated. Metadata only —
// transcripts are loaded on demand via /api/admin/chats/[id].
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await callerIsAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  try {
    const users = await listAllChats();
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load chats." }, { status: 500 });
  }
}
