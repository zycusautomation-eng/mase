import { NextRequest, NextResponse } from "next/server";
import { callerEmail, getFavs, setFavs } from "@/lib/favourites/server";

// Personal favourites (starred deals), persisted per logged-in user in app_config.
// Every verb resolves the caller from their Supabase session, so a user only ever
// reads/writes their own row — this handler is the gate (service role under it).
export const dynamic = "force-dynamic";

export async function GET() {
  const email = await callerEmail();
  if (!email) return NextResponse.json({ favs: [] }); // signed out → nothing starred
  try {
    return NextResponse.json({ favs: await getFavs(email) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const email = await callerEmail();
  if (!email) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const oppIds = Array.isArray(body?.opp_ids) ? (body.opp_ids as unknown[]).map(String) : [];
  try {
    return NextResponse.json({ favs: await setFavs(email, oppIds) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
