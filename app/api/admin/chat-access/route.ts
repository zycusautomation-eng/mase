import { NextRequest, NextResponse } from "next/server";
import {
  getChatAccess, setChatAccess, chatAllowedForCaller, callerIsAdmin, type ChatAccessMode,
} from "@/lib/config/server";

// RevOps Chat access policy.
//   GET  — returns { allowed } for the CURRENT caller (any signed-in user; the nav +
//          /chat guard read it). Admins additionally get { mode, emails } to edit.
//   POST — admin-only; sets { mode, emails }.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const allowed = await chatAllowedForCaller();
    const isAdmin = await callerIsAdmin();
    if (isAdmin) {
      const { mode, emails } = await getChatAccess();
      return NextResponse.json({ allowed, isAdmin, mode, emails });
    }
    return NextResponse.json({ allowed, isAdmin: false });
  } catch (e) {
    return NextResponse.json({ allowed: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function POST(req: NextRequest) {
  if (!(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  let body: { mode?: ChatAccessMode; emails?: string[] } = {};
  try { body = await req.json(); } catch { /* empty → defaults below */ }
  try {
    const saved = await setChatAccess({ mode: body.mode ?? "admins", emails: body.emails ?? [] });
    return NextResponse.json({ ...saved, allowed: true, isAdmin: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
