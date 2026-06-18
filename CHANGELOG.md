# CHANGELOG — MASE frontend (`MASE`)

> **Agents & teammates: read this after every `git pull`.** Running log of
> behaviour-changing decisions and conventions, newest first. Add an entry when you
> change behaviour, a contract with the backend, or how another agent should work.

---

## 2026-06-18 — Fix: knowledge upload 500 (MASE corpus not registered in `projects`)

**What.** Uploading to the MASE knowledge corpus returned 500:
`documents_project_id_fkey` violation — `documents.project_id` has a FK to the
`projects` table, and `MASE_KNOWLEDGE_PROJECT_ID` (7e9b2f48-…) had never been inserted
there. Registered the corpus as a row in `projects` (id = MASE_KNOWLEDGE_PROJECT_ID,
name "MASE Knowledge", status active). Upload now works (verified to ~28K chars).

**How to work with it.** Any new corpus `project_id` MUST exist as a row in `projects`
before documents can be uploaded to it (FK). If we ever change MASE_KNOWLEDGE_PROJECT_ID
or spin up a fresh DB, register the project first. (Follow-up option: have the upload
endpoint idempotently ensure the project row exists.)

## 2026-06-18 — Knowledge corpus: one wired MASE corpus (upload → retrieval connected)

**What.** Replaced the leftover VIBE "Bite Size 2.0 / v1" corpus picker with a single
canonical MASE knowledge corpus (`MASE_KNOWLEDGE_PROJECT_ID` in `lib/engine/helpers.ts`).
Admin → Knowledge now uploads into it (no picker), and the "Run with AI" todo-runner sends
that `project_id` on every run (`AgentRun.tsx`), so `search_knowledge` actually retrieves
the uploaded docs while drafting.

**Why / how to work with it.** Before, uploads went to a VIBE project the MASE agent never
searched (it passed no `project_id`), so uploaded knowledge never reached the agent — the
feature was disconnected. Now writer (upload) and reader (agent run) share one
`project_id`. Backend needed no change (`request.project_id` → `_current_project_id` →
`search_knowledge` already wired). Note: any docs previously uploaded under the old Bite
Size ids are NOT in the new corpus — re-upload them. The chat strategist still passes no
project_id (only the todo-runner is wired); wire it the same way if it should use the
knowledge base too.

## 2026-06-18 — Admin UI: hide deal-filter bar on Admin; modern knowledge uploader

**What.** (1) The deal ScopeFilterBar (VP/RSD/forecast/country/size/AI/quarter + "N of N
deals") no longer renders on `/admin` — it's a deal-book filter, not an agent-control
surface (`app/(dashboard)/layout.tsx` `showScope`). (2) Rebuilt the Knowledge → Upload UI
(`admin/page.tsx` DocumentsSection + `dashboard.css` `.kn-*`): a real drag-and-drop
dropzone with hover/drag states, a selected-file chip (type badge, size, remove), a clean
3-up metadata grid, file-OR-paste (not both at once), inline error/success states, and a
tidier document list with type badges.

**Why / how to work with it.** Design cleanup. No API/contract change. The uploader still
posts the same `/api/documents/upload` body (file_b64+filename or content, project_id,
doc_type).

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
