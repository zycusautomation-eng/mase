import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/tracking/server";

// Usage-event sink. The client posts {event, path, meta}; the server stamps the
// caller's session email (logEvent) and records it. Always 200 — tracking failures
// must never affect the user.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let b: { event?: string; path?: string; meta?: unknown } = {};
  try { b = await req.json(); } catch { /* ignore bad body */ }
  await logEvent(String(b.event || "unknown"), String(b.path || ""), b.meta);
  return NextResponse.json({ ok: true });
}
