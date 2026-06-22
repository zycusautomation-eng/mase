# CHANGELOG — MASE frontend (`MASE`)

> **Agents & teammates: read this after every `git pull`.** Running log of
> behaviour-changing decisions and conventions, newest first. Add an entry when you
> change behaviour, a contract with the backend, or how another agent should work.

---

## 2026-06-22 — Auth: request Outlook mail scopes + capture per-user MS refresh token

**What.** Two changes so MASE can send/draft/read email as the signed-in user from their own Outlook:
1. **`app/login/page.tsx`** — the "Sign in with Microsoft" `signInWithOAuth` now requests
   `offline_access`, `https://graph.microsoft.com/Mail.ReadWrite`, and
   `https://graph.microsoft.com/Mail.Send` on top of `openid profile email`. Users see a
   one-time Microsoft consent prompt for mail access on their next login.
2. **`app/auth/callback/route.ts`** — after `exchangeCodeForSession`, the user's
   `provider_refresh_token` is upserted into `public.user_ms_tokens` via a **service-role**
   client (best-effort; a failure never blocks sign-in). That token is only present on the
   session immediately after the OAuth exchange, so it must be captured here.

**Why.** The backend Outlook MCP server (`outlook_send_mail` / `outlook_create_draft` /
`outlook_list_messages` / `outlook_get_message` / `outlook_reply`) acts as the user via Graph
`/me/...`, resolving `chat_id → chats.user_id → user_ms_tokens.refresh_token`. Without
capturing the token here, the backend has nothing to send with.

**Contract / backend.** Requires table `public.user_ms_tokens` (`user_id` pk, `refresh_token`,
`scope`, `updated_at`; RLS on, service-role only) and admin consent on the Entra SSO app
(`98489e0f…`) for delegated `Mail.ReadWrite` / `Mail.Send` / `offline_access`. **Existing users
must sign in again** to grant the new scopes and have their token captured. Token is stored
plaintext for now — encrypt-at-rest is a follow-up.

**Also added — direct Outlook test surface (no chatbot):**
- **`app/api/outlook/[[...path]]/route.ts`** — server-side proxy to the backend
  `/api/outlook/*` endpoints; attaches the shared Bearer token and **injects the signed-in
  user's Supabase id** (a user can only act as themselves; the browser can't impersonate).
- **`app/(dashboard)/outlook-test/page.tsx`** — a page (route `/outlook-test`) with connection
  status + a To/Subject/Body form and **Send / Create draft / List inbox** buttons that call the
  backend Outlook logic directly (same code as the `outlook_*` MCP tools), bypassing the agent.
  Backend endpoints: `GET /api/outlook/status|messages`, `POST /api/outlook/send|draft`.

---

## 2026-06-20 — Proxy: fix "Couldn't save" on Next Step (timeout + author-as-rep)

**What.** Two changes to the deal-engine proxy (`app/api/deal-engine/[[...path]]/route.ts`):
1. **`export const maxDuration = 60`** — the to-do *write* endpoints make synchronous
   Salesforce round-trips, and the `next_step` destination is a read-modify-write on
   `Opportunity.Next_Step__c` after a cold simple-salesforce login. Vercel's short
   **default** function timeout was killing the request before the backend responded,
   so the rep saw **"Couldn't save the update — try again"** even though nothing was
   wrong (the backend never logged the request — it died at the Vercel hop).
2. **`isUpdatePath` → token injection for `/todo/update`** — previously only
   `/todo/push` had the caller's Salesforce OAuth token injected. Now `/todo/update`
   gets it too, so the completed Task / open Task / Next_Step append is authored **as
   the rep**, not the shared integration user. Falls through to the shared user if the
   rep hasn't connected Salesforce (try/catch, unchanged behaviour).

**Why.** Marc couldn't save a Next Step. Root cause was the Vercel-side timeout, not a
backend bug — the backend returns `ok:true` (with `sf_error`) even on a real SF write
failure, so "Couldn't save" can only be an HTTP non-2xx, which was the proxy timing out.

**Validated locally** before ship: `tsc --noEmit` clean; route compiles with `maxDuration`;
matcher unit-tested (push+update inject, nothing else); live `POST /todo/update` reaches
the backend and 400s on missing field (no SF write); injection branch degrades gracefully
with no session. True timeout behaviour + "authored as rep" only observable post-deploy.

## 2026-06-19 — Add-update branches to 3 destinations (Next Step / open To-Do / Completed)

**What.** The deal-drawer "Add update" form (`AddUpdateForm` in `components/deals/DealDrawer.tsx`)
now lets the rep pick a **destination** before saving: **Completed task** (default — the prior
behaviour), **To-do (open)** (a MASE row + an OPEN Salesforce Task, `Status='Planned'`), or
**Next step** (appended **newest-on-top** to `Opportunity.Next_Step__c`, preserving the full
existing trail). Each carries a **due date**. `addUpdate()` in `lib/engine/useBackendTodos.ts`
now passes `destination` + `due_date` to **`POST /api/deal-engine/todo/update`** (the backend
already branches on these). Default stays `completed`, so existing callers are unaffected.

## 2026-06-19 — Chat is now realtime/streaming (VIBE pattern)

**What.** The RevOps chat (`app/(dashboard)/chat/page.tsx`) no longer does a blocking
`fetch('/api/deal-engine/chat')` that waits for the whole answer (which timed out at the proxy on
long tool runs). It now mirrors VIBE's chat: `send()` POSTs to **`/api/deal-engine/chat/async`**
with `{chat_id, messages, opp_ids?}`, gets `{chat_id}` back instantly, then **subscribes to
`chat_messages` over Supabase realtime** (`channel('mase-chat:'+chatId)`, `postgres_changes` on
`chat_messages` filtered by `chat_id`) and renders rows live: `thinking` + `tool_call`/`tool_result`
roll up into a collapsible **"Agent working…"** trace accordion, and `final`/`message` becomes the
answer bubble. Includes a 3s **polling fallback** (rebuilds the trace from the DB if realtime isn't
connected) and a 180s **watchdog**. Sidebar/saved-chats, scoping, locked-user behavior, and the
admin prompt panel are preserved.

**How to work with it.** Backend contract: POST `/api/deal-engine/chat/async` → `{chat_id}` (fast);
everything else arrives via `chat_messages` realtime (same shared Supabase project as VIBE). New CSS:
`.chat-working` / `.chat-trace*` in `dashboard.css`. See the backend changelog (same date) for the
endpoint + the timeout fix.

**Nested Todo-Runner sub-trace + admin-only chat (same day).** When the chat delegates via
`run_todo`, the Todo Runner's own steps now arrive as `chat_messages` rows tagged
`metadata.group:"todo"` and render as a nested "Todo Runner working…" sub-accordion inside the
main trace (`.chat-trace-todo` in `dashboard.css`); the watchdog is bumped to 300s so a long
streaming delegation never trips it. Also: the RevOps chat is now **admin-only** — the proxy
(`app/api/deal-engine/[[...path]]/route.ts`) gates `/chat`, `/chat/async`, and `/chat/prompt`
(GET + POST) on `callerIsAdmin()`.

---

## 2026-06-19 — Admin: Chat Agent prompt tab

**What.** Added a **Chat Agent** tab in Admin → Agent Control (between Deal Sweep and
Execution), editing the RevOps chat's system prompt via `/api/deal-engine/chat/prompt`
(`PromptEditor`, key `mase_chat_agent`). Pairs with the backend change (same date) that
made the chat a tool-using agent — it now shares the MASE knowledge base (`search_knowledge`)
and can delegate drafting to-dos to the Todo Runner (`run_todo`).

**How to work with it.** The editor edits only the base persona/strategy prompt; the book of
deals + the tools/capabilities block are appended by the backend automatically. The chat-page
panel still works too — both write the same Supabase key.

---

## 2026-06-19 — Knowledge uploads: multiple files + direct-to-S3 (no size limit)

**What.** Two changes to Admin → Knowledge → "+ Add document":
1. **Multiple files at once** — the dropzone/file input accept many files; each is
   staged in a queue with a per-file status (queued → uploading → ✓/✕) and becomes its
   own document, named by filename. The single text-paste path stays.
2. **Direct-to-S3 upload, no size limit** — instead of base64-in-a-JSON-body through the
   proxy (capped at ~4.5 MB on Vercel serverless), each file is now PUT **straight to S3**
   via a presigned URL (`POST /api/deal-engine/knowledge/presign`), then registered with
   `POST /api/deal-engine/knowledge` carrying `s3_key`; the backend pulls it from S3 and
   extracts. The raw `File` is PUT directly (no client-side read), so multi-MB decks work.

**How to work with it.** Backend contract: presign → returns `{url, key}`; PUT the file
to `url`; then POST `{name, doc_type, s3_key, filename}`. Removed the 15 MB cap (only
file *type* is validated client-side). See the backend CHANGELOG (same date) for the S3
bucket + IAM. `DocumentsSection` in `app/(dashboard)/admin/page.tsx`.

## 2026-06-18 — Knowledge UI: document-first, upload modal, delete; Excel/PPTX/CSV/etc.

**What.** Admin → Knowledge now shows the **uploaded documents first** (with a Delete
button per doc + a type badge + date); **uploading moved into a modal** opened by
"+ Add document" (dropzone or paste text). File support broadened: PDF, Word, **Excel
(.xlsx/.xlsm)**, **PowerPoint (.pptx)**, CSV/TSV, Markdown, TXT, JSON/XML/YAML/log —
binary types are extracted server-side (openpyxl/python-pptx/pypdf/docx) into the
isolated MASE store. Delete hits `DELETE /api/deal-engine/knowledge/{id}`.

**How to work with it.** All formats verified end-to-end on the isolated store (e.g. an
Excel sheet extracts to tab-separated rows). The 500/"Internal Server Error" JSON-parse
error was a backend bug (`mase_knowledge` imported a non-existent `config` module) — fixed.

## 2026-06-18 — Knowledge is now a fully isolated MASE system (not VIBE projects)

**What.** MASE knowledge no longer lives in VIBE's shared `projects`/`documents` tables
(which is why "MASE Knowledge" was showing in the VIBE project list). It now has its OWN
isolated, RLS-locked tables (`mase_documents`/`mase_document_chunks`), and the admin
uploader/list talk to new endpoints `GET/POST/DELETE /api/deal-engine/knowledge` (no
`project_id`). The old "MASE Knowledge" projects row was deleted, so it's gone from VIBE.

**How to work with it.** Admin → Knowledge uploads into the MASE-only store; the
todo-runner's `search_knowledge` routes the MASE namespace marker to the MASE tables.
Nothing here touches VIBE. The `MASE_KNOWLEDGE_PROJECT_ID` constant remains ONLY as the
runtime routing marker the todo-runner sends (it is no longer a real project).

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
