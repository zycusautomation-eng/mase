import { NextRequest, NextResponse } from "next/server";

// Server-side proxy for the agent runtime (the SAME deep-agent endpoints VIBE
// uses). The browser calls same-origin /api/agent/* and this handler attaches
// the shared Bearer token and forwards to the FastAPI backend's /api/chat/*
// surface. The token never reaches the client.
//
//   POST /api/agent/async  -> backend POST /api/chat/async   (start a task run)
//   POST /api/agent/stop   -> backend POST /api/chat/stop     (cancel a run)
//   GET  /api/agent/active -> backend GET  /api/chat/active   (running runs)
//
// The agent writes its work (thinking / tool_call / tool_result / status /
// final) to Supabase `chat_messages` in real-time; the MASE panel subscribes to
// realtime by chat_id and never needs to read this HTTP stream.

const BASE = process.env.DEAL_ENGINE_API_BASE;
const TOKEN = process.env.DEAL_ENGINE_TOKEN;

export const dynamic = "force-dynamic";

function targetUrl(path: string[] | undefined, search: string): string {
  const suffix = path && path.length ? "/" + path.join("/") : "";
  return `${BASE}/api/chat${suffix}${search}`;
}

async function forward(req: NextRequest, path?: string[]): Promise<NextResponse> {
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
    return NextResponse.json({ error: `Failed to reach agent backend: ${msg}` }, { status: 502 });
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
