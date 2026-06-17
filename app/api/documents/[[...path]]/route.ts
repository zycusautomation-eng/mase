import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";

// Admin-only server-side proxy for the agent's knowledge base (documents +
// document_chunks). The browser calls same-origin /api/documents/* and this
// handler (a) enforces admin-only access via the Supabase session, and (b)
// forwards to the backend with the shared Bearer token.
//
// SECURITY: the backend POST /api/documents/upload has no auth of its own, so
// admin enforcement MUST live here — every method below is gated on
// callerIsAdmin() before anything is forwarded. Non-admins get 403.

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const dynamic = "force-dynamic";

async function callerIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return ADMIN_EMAILS.has((data.user?.email || "").toLowerCase());
  } catch {
    return false;
  }
}

function targetUrl(path: string[] | undefined, search: string): string {
  const suffix = path && path.length ? "/" + path.join("/") : "";
  return `${BASE}/api/documents${suffix}${search}`;
}

async function forward(req: NextRequest, path?: string[]): Promise<NextResponse> {
  if (!BASE || !TOKEN) {
    return NextResponse.json(
      { error: "Server is missing DEAL_ENGINE_API_BASE or DEAL_ENGINE_TOKEN." },
      { status: 500 }
    );
  }
  const url = targetUrl(path, req.nextUrl.search);
  const init: RequestInit = {
    method: req.method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  try {
    const upstream = await fetch(url, init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to reach backend: ${msg}` }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!(await callerIsAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await callerIsAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { path } = await ctx.params;
  return forward(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!(await callerIsAdmin())) return NextResponse.json({ error: "Admin only." }, { status: 403 });
  const { path } = await ctx.params;
  return forward(req, path);
}
