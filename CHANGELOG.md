# CHANGELOG — MASE frontend (`MASE`)

> **Agents & teammates: read this after every `git pull`.** Running log of
> behaviour-changing decisions and conventions, newest first. Add an entry when you
> change behaviour, a contract with the backend, or how another agent should work.

---

## 2026-06-18 — Agent onboarding: AGENTS.md + CLAUDE.md

**What / why.** Added `AGENTS.md` (the guide coding agents auto-load) + a `CLAUDE.md`
pointer, with copy-paste prompts (session catch-up, post-pull "what changed", pre-push
wrap-up), so every agent understands changes that come with each push. **Start every
session by reading `AGENTS.md` then `CHANGELOG.md`.** Reminder: pushing `main`
auto-deploys to Vercel — keep `npx tsc --noEmit` clean.

## 2026-06-18 — Agent system prompts are edited in the app, stored in Supabase

**What.** Admin → Agent Control has two prompt editors — **Todo Runner** (the "Run
with AI" Tactical Fulfillment agent) and **Deal Sweep** — plus the chat agent's prompt
panel on the chat page. Each reads/writes a backend endpoint that persists to Supabase:
`/api/deal-engine/todo-runner/prompt`, `/api/deal-engine/sweep/prompt`,
`/api/deal-engine/chat/prompt`.

**Why / how to work with it.**
- Supabase is the SOURCE OF TRUTH for prompts. To change agent behaviour, edit the
  prompt in the Admin UI — do not hardcode prompts in the frontend.
- `components/agent/AgentRun.tsx` fetches the todo-runner prompt from
  `/api/deal-engine/todo-runner/prompt` per run; the `DRAFTING_SYSTEM_PROMPT` constant
  there is now only a **deprecated offline fallback** (do not edit it to change
  behaviour). Keep it in sync with the backend seed if you must touch it.
- Proxy `app/api/deal-engine/[[...path]]/route.ts` admin-gates prompt **writes**
  (chat/sweep/todo-runner) and the todo-runner **runs** feed; the todo-runner prompt
  **GET stays open** because every rep's run reads it.

## 2026-06-18 — Admin → Execution: two run feeds

The Execution tab shows **Deal Sweep runs** and **Todo Runner runs** separately (the
latter from `/api/deal-engine/todo-runner/runs`, with per-run status badges).

## 2026-06-18 — Admin-only surfaces hidden during simulation

Admin-only sections (Runs, Learning, Sync Quality, Admin, the chat prompt panel) gate
on `isAdminView` (`realIsAdmin && !simEmail`) so they're hidden while an admin simulates
a rep/VP. Admin-only writes are also enforced server-side at the deal-engine proxy.
