import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_EMAILS } from "@/lib/engine/helpers";
import { freshAccessToken } from "@/lib/sfdc/server";
import { chatAllowedForCaller } from "@/lib/config/server";

// Server-side proxy. The browser calls same-origin /api/deal-engine/* and this
// handler attaches the Bearer token (kept in a server-side env var) and forwards
// the request to the Replit FastAPI backend. The token never reaches the client.

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const dynamic = "force-dynamic"; // never cache deal data at the proxy layer
// The to-do WRITE endpoints make synchronous Salesforce round-trips (the next_step
// destination is a read-modify-write on Opportunity.Next_Step__c after a cold
// simple-salesforce login). Without this, Vercel's short default function timeout
// can kill the request before the backend responds — the user sees "Couldn't save
// — try again" even though nothing is wrong. Give the proxy room to wait.
export const maxDuration = 60;

// The agent system-prompt editors edit behaviour for the whole team, so they must
// be ADMIN-only — both the chat / todo-runner agent (chat/prompt) and the Deal
// Intelligence Engine sweep agent (sweep/prompt). The backend sits behind a single
// shared token (every user proxies with it), so per-user admin enforcement has to
// live HERE, where the Supabase session identifies the caller. Covers GET (reading
// the prompt) and POST (writing it).
function isPromptPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[1] === "prompt"
    && (path[0] === "chat" || path[0] === "sweep");
}

// The to-do push: /api/deal-engine/todo/push. We enrich its body with the
// caller's Salesforce OAuth token so the backend creates the Task AS the rep.
function isPushPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "todo" && path[1] === "push";
}

// The manual deal update: /api/deal-engine/todo/update. Same as push — it writes to
// Salesforce (a completed/open Task, or an Opportunity.Next_Step__c append), so it
// also needs the caller's OAuth token injected to be authored AS the rep instead of
// the shared integration user. Token-injection treats push and update identically.
function isUpdatePath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "todo" && path[1] === "update";
}

// Admin-only WRITES the proxy must gate even though the backend trusts the shared
// token (the UI gate isAdminView is bypassable by calling the API directly). The
// Learning Observatory is admin-only: POST /learnings + POST /learnings/{id}
// (activate/pause/retire). GET subpaths (list, /signals) stay readable.
function isLearningsWritePath(path?: string[]): boolean {
  return !!path && path.length >= 1 && path[0] === "learnings";
}

// The todo-runner ('Run with AI') agent prompt: WRITE is admin-only, but the GET
// must stay open because every rep's run fetches the effective prompt to send it.
// So this gates POST only (not GET, unlike isPromptPath for chat/sweep).
function isTodoRunnerPromptPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "todo-runner" && path[1] === "prompt";
}

// The todo-runner runs feed (Admin -> Execution) lists what reps ran — admin-only
// to READ (gated on GET, below). It is read-only so there's no POST to gate.
function isTodoRunnerRunsPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "todo-runner" && path[1] === "runs";
}

// MASE's isolated knowledge store (upload/list/delete). Admin-only on every verb —
// it's the Admin -> Knowledge management surface. /knowledge and /knowledge/{id}.
function isKnowledgePath(path?: string[]): boolean {
  return !!path && path.length >= 1 && path[0] === "knowledge";
}

// The RevOps chat itself is ADMIN-ONLY: the sync /chat, the streaming /chat/async,
// and the /chat/prompt editor (prompt is also covered by isPromptPath). Anything
// under `chat`. The backend trusts the shared token, so this proxy is the real gate.
function isChatPath(path?: string[]): boolean {
  return !!path && path.length >= 1 && path[0] === "chat";
}

// The bulk/per-opp sweep rerun trigger (Admin -> Execution "Rerun sweeps"). It
// enqueues sweeps for a selection (all / failed / by owner / by forecast / one opp),
// so it is a WRITE and must be admin-only. POST /api/deal-engine/sweep/rerun. The
// backend trusts the shared token, so this proxy is the real gate.
function isSweepRerunPath(path?: string[]): boolean {
  return !!path && path.length === 2 && path[0] === "sweep" && path[1] === "rerun";
}

async function callerIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient();
    // Primary: getUser() validates the access token against the Supabase auth
    // server. On Vercel that round-trip can come back empty when the access token
    // has expired and the edge middleware (which deliberately does NOT refresh —
    // see lib/supabase/middleware.ts) left it stale, which wrongly locks out a
    // real admin whose browser session is still valid.
    const { data: u, error } = await supabase.auth.getUser();
    let email = u?.user?.email ?? null;
    // Fallback: read the email off the signed session JWT in the cookie (no auth
    // server round-trip). This is a feature gate over a backend that is itself
    // token-authed, so trusting the httpOnly Supabase cookie here is acceptable —
    // it only decides whether to forward, never grants backend access on its own.
    if (!email) {
      const { data: s } = await supabase.auth.getSession();
      email = s?.session?.user?.email ?? null;
    }
    if (!email) {
      console.warn("[deal-engine proxy] callerIsAdmin: no user/session resolved",
        error?.message || "");
    }
    return ADMIN_EMAILS.has((email || "").toLowerCase());
  } catch (e) {
    console.error("[deal-engine proxy] callerIsAdmin threw:",
      e instanceof Error ? e.message : String(e));
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
  // Admin-only reads: the team-wide chat/sweep system prompts (may encode strategy
  // / guardrails) and the todo-runner runs feed (shows what reps ran). The
  // todo-runner PROMPT GET stays open (reps' runs fetch it). Other GETs stay open.
  if ((isPromptPath(path) || isTodoRunnerRunsPath(path) || isKnowledgePath(path)) && !(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  // Chat conversational endpoints: admin OR the admin-set "enable chat for users"
  // toggle. The chat/prompt EDITOR stays admin-only (caught by isPromptPath above).
  if (isChatPath(path) && !isPromptPath(path) && !(await chatAllowedForCaller())) {
    return NextResponse.json({ error: "Chat is not enabled for your account yet." }, { status: 403 });
  }
  return forward(req, path);
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  // Knowledge doc deletion is admin-only.
  if (isKnowledgePath(path) && !(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  return forward(req, path);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  // Admin-only writes: the team-wide system prompts (chat/sweep + the todo-runner),
  // Learning Observatory mutations, and knowledge uploads. The backend trusts the
  // shared token, so this proxy is the real gate.
  if ((isPromptPath(path) || isTodoRunnerPromptPath(path) || isLearningsWritePath(path) || isKnowledgePath(path) || isSweepRerunPath(path))
      && !(await callerIsAdmin())) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }
  // Chat conversational writes (/chat, /chat/async, /chat/stop): admin OR the
  // "enable chat for users" toggle. The chat/prompt editor stays admin-only above.
  if (isChatPath(path) && !isPromptPath(path) && !(await chatAllowedForCaller())) {
    return NextResponse.json({ error: "Chat is not enabled for your account yet." }, { status: 403 });
  }
  // To-do push / manual update: inject the caller's Salesforce token so the write
  // (Task or Next_Step__c append) is authored as the rep. If they haven't connected,
  // we forward unchanged and the backend falls back to the shared integration user.
  if (isPushPath(path) || isUpdatePath(path)) {
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
