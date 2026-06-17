import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";
import { freshAccessToken } from "@/lib/sfdc/server";

// Server-side proxy. The browser calls same-origin /api/deal-engine/* and this
// handler attaches the Bearer token (kept in a server-side env var) and forwards
// the request to the Replit FastAPI backend. The token never reaches the client.

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const dynamic = "force-dynamic"; // never cache deal data at the proxy layer

// The chat agent's system-prompt editor (chat/prompt) edits behaviour for the
// whole team, so it must be ADMIN-only. The backend sits behind a single shared
// token (every user proxies with it), so per-user admin enforcement has to live
// HERE, where the Supabase session identifies the caller.
function isPromptPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "chat" && path[1] === "prompt";
}

// The to-do push: /api/deal-engine/todo/push. We enrich its body with the
// caller's Salesforce OAuth token so the backend creates the Task AS the rep.
function isPushPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "todo" && path[1] === "push";
}

// Admin-only WRITES the proxy must gate even though the backend trusts the shared
// token (the UI gate isAdminView is bypassable by calling the API directly). The
// Learning Observatory is admin-only: POST /learnings + POST /learnings/{id}
// (activate/pause/retire). GET subpaths (list, /signals) stay readable.
function isLearningsWritePath(path?: string[]): boolean {
  return !!path && path.length >= 1 && path[0] === "learnings";
}

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
  return `${BASE}/api/deal-engine${suffix}${search}`;
}

async function forward(req: NextRequest, path?: string[], bodyOverride?: string): Promise<NextResponse> {
  if (!BASE || !TOKEN) {
    return NextResponse.json(
      { error: "Server is missing DEAL_ENGINE_API_BASE or DEAL_ENGINE_TOKEN. Set them in .env.local." },
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
    init.body = bodyOverride !== undefined ? bodyOverride : await req.text();
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
    return NextResponse.json({ error: `Failed to reach Deal Engine backend: ${msg}` }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  // The system prompt is the team-wide agent instruction set (may encode strategy
  // / guardrails), so reading it is admin-only too. Other GETs stay open.
  if (isPromptPath(path) && !(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  // Admin-only writes: the team-wide system prompt and Learning Observatory
  // mutations. The backend trusts the shared token, so this proxy is the real gate.
  if ((isPromptPath(path) || isLearningsWritePath(path)) && !(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  // To-do push: inject the caller's Salesforce token so the Task is created as
  // the rep. If they haven't connected, we forward unchanged and the backend
  // falls back to the shared integration user.
  if (isPushPath(path)) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        const tok = await freshAccessToken(data.user.id);
        if (tok) {
          const raw = await req.text();
          let body: Record<string, unknown> = {};
          try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
          body.sf_access_token = tok.access_token;
          body.sf_instance_url = tok.instance_url;
          return forward(req, path, JSON.stringify(body));
        }
      }
    } catch {
      /* fall through — forward unchanged, backend uses the shared user */
    }
  }
  return forward(req, path);
}
