import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Server-side proxy for the direct Outlook test endpoints (no agent/LLM).
// Browser calls same-origin /api/outlook/* ; this attaches the shared Bearer
// token AND injects the signed-in user's Supabase id (so a user can only act as
// themselves — the browser cannot impersonate). Forwards to backend
// /api/outlook/* (status | messages | send | draft).

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function currentUserId(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function forward(req: NextRequest, path?: string[]): Promise<NextResponse> {
  if (!BASE || !TOKEN) {
    return NextResponse.json(
      { error: "Server is missing DEAL_ENGINE_API_BASE or DEAL_ENGINE_TOKEN. Set them in .env.local." },
      { status: 500 }
    );
  }
  const userId = await currentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const suffix = path && path.length ? "/" + path.join("/") : "";
  const url = new URL(`${BASE}/api/outlook${suffix}`);
  req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v));

  const init: RequestInit = {
    method: req.method,
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  };

  if (req.method === "GET" || req.method === "HEAD") {
    url.searchParams.set("user_id", userId); // identity injected server-side
  } else {
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }
    body.user_id = userId; // override any client-supplied value
    init.body = JSON.stringify(body);
  }

  try {
    const upstream = await fetch(url.toString(), init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to reach Outlook backend: ${msg}` }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return forward(req, path);
}
