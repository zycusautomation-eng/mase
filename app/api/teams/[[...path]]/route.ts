import { NextRequest, NextResponse } from "next/server";
import { callerIsAdmin } from "@/lib/config/server";

// Server-side proxy for the MASE Teams-bot control room. Mirrors the deal-engine
// proxy: the browser calls same-origin /api/teams/*, this attaches the shared Bearer
// token (server-only env) and forwards to the FastAPI backend's /api/teams/*.
//
// The WHOLE control room is admin-only. The backend trusts the shared token (every
// caller proxies with it), so — exactly like the deal-engine proxy — per-user admin
// enforcement must live HERE, where the Supabase session identifies the caller.

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function targetUrl(path: string[] | undefined, search: string): string {
  const suffix = path && path.length ? "/" + path.join("/") : "";
  return `${BASE}/api/teams${suffix}${search}`;
}

async function forward(req: NextRequest, path?: string[]): Promise<NextResponse> {
  if (!BASE || !TOKEN) {
    return NextResponse.json(
      { error: "Server is missing DEAL_ENGINE_API_BASE or DEAL_ENGINE_TOKEN." },
      { status: 500 }
    );
  }
  if (!(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const init: RequestInit = {
    method: req.method,
    headers: { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const upstream = await fetch(targetUrl(path, req.nextUrl.search), init);
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Failed to reach MASE backend: ${msg}` }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path);
}
