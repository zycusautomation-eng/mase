// Client-side API wrapper. Calls the same-origin proxy (which injects the Bearer
// token server-side). Always checks res.ok and surfaces { error } as a thrown Error.

import type {
  Descriptor,
  Health,
  Team,
  OpportunitiesResponse,
  DealRecord,
  TodoResponse,
  MatchaResponse,
  ChatMessage,
  ChatResponse,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/deal-engine${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

function ownerQuery(owner?: string): string {
  if (!owner || owner === "all") return "";
  return `?owner=${encodeURIComponent(owner)}`;
}

export const dealEngine = {
  descriptor: () => request<Descriptor>(""),
  health: () => request<Health>("/health"),
  team: () => request<Team>("/team"),
  opportunities: (owner?: string) => request<OpportunitiesResponse>(`/opportunities${ownerQuery(owner)}`),
  opportunity: (oppId: string) => request<DealRecord>(`/opportunities/${encodeURIComponent(oppId)}`),
  todo: (owner?: string) => request<TodoResponse>(`/todo${ownerQuery(owner)}`),
  matcha: (owner?: string) => request<MatchaResponse>(`/matcha${ownerQuery(owner)}`),
  chat: (messages: ChatMessage[], owner?: string, model?: string) =>
    request<ChatResponse>("/chat", {
      method: "POST",
      body: JSON.stringify({
        messages,
        ...(owner && owner !== "all" ? { owner } : {}),
        ...(model ? { model } : {}),
      }),
    }),
};
