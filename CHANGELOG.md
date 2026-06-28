# CHANGELOG — MASE frontend (`MASE`)

> **Agents & teammates: read this after every `git pull`.** Running log of
> behaviour-changing decisions and conventions, newest first. Add an entry when you
> change behaviour, a contract with the backend, or how another agent should work.

---

## 2026-06-27 — Deal Scores: separate sortable columns + band filters

**What.** Split the single "Scores" strip into **five separate, sortable columns** — Win, Mom,
Cmt, Risk, FC (`SCORE_COLS` in `deals/page.tsx`; sort reads `ai.deal_scores.headline.<key>`),
each a colour-banded number (`ScoreCell`). Added **band-bucket filters** for all five in the
filter bar so a VP/CRO can pull deals by score: Win/Commitment/FC = High/Mid/Low, Momentum =
Forward/Flat/Slipping, Risk = High/Med/Low. Band logic centralised in `helpers.ts`
(`scoreBand` for labels/filtering, `scoreColorBand` for colour, `SCORE_BANDS` for options);
`DealFilters` grows win/momentum/commitment/risk/fc with matching predicates in `DashboardContext`.
No Read column or filter (per request); the drawer panel is unchanged.

**Why.** Requested — separate columns + filterability so leadership can slice the book by
individual scores ("high-Win, slipping-Momentum deals"). Additive; graceful absence retained.

## 2026-06-27 — Deal Scores UI (table strip + drawer panel)

**What.** New `components/deals/DealScores.tsx` surfaces the backend's `ai.deal_scores`
(Win / Momentum / Commitment / Risk + the **FC** roll-up + a **Read** confidence label):
- **Deals table** — a compact `DealScoreStrip` in a new **"Scores"** column (W/M/C/R chips +
  FC + Read), and the column header **sorts by FC** (`sortKey === "fc"` reads
  `ai.deal_scores.headline.forecast_confidence`).
- **Deal drawer** — a `DealScorePanel` card: the FC roll-up + Read prominent, then one row per
  score (number · label · 2-sentence commentary) with a **"why"** expander showing the
  contributing factors (factor · points · evidence).
- **Colour bands** per spec: default ≥60 g / 40–59 a / <40 r; Risk inverted; Momentum centred on
  50; Read Full=green/Solid=blue/Partial=amber/Early=grey. Global `.ds-*` CSS.

**Why.** Render the deterministic deal scores the backend now attaches. Purely additive — no
existing column/filter/verdict-chip changed; **graceful absence** (a deal with no `deal_scores`
renders nothing, no zeros/broken chips) so it's safe before every deal is scored.

## 2026-06-27 — Show the known economic buyer + clear the false "EB missing" alert

**What.** The sweep marks the economic buyer as a `gap` on deals where it never landed in a
SF contact role / swept call — but for 17 deals across the 440 book the EB **is** recorded in
the MEDDPICC custom object, so that gap is a *visibility* false-positive. New `getEbOverride`
(`helpers.ts`) holds those 17 confirmed EB names keyed by 15-char opp_id. In `DealDrawerView`:
when an override exists, (1) `ebGap` is forced false so the red **"Economic Buyer unmapped"
SPOF** and the **"Main blocker: Economic Buyer"** no longer fire; (2) a green **"Economic buyer:
<name> · confirmed in MEDDPICC"** line renders where the SPOF was; (3) the MEDDPICC scorecard
"Econ. Buyer" row shows green/Confirmed (name on hover); (4) Open-risks drops any *visibility*
EB risk ("not identified / unmapped / no access to power") — but **keeps engagement risks**
("not engaged / single-threaded"). The deal's **engagement verdict (`north_star_verdict`) is
untouched** — at-risk deals stay at-risk on engagement grounds, not EB visibility.

**Why.** Requested. EB visibility isn't the problem on these deals (the buyer is known); whether
the buyer is *engaged* is the real question, and that's already read from the stored sweep. Only
the 17 firmly-named (Confirmed) deals are injected; the partial/role-only ones are left as-is.

## 2026-06-27 — Weighted "all deals" drawer (VP / RSD filter + sort)

**What.** The Weighted Forecast (and Weighted Pipeline) modal now has a **"See all N deals →"**
footer that opens a full right-side **drawer** (`WeightedDrawer` in `DealsStats.tsx`, reusing the
`.drawer`-style slide-in as `.wfd`). The drawer lists **every** open deal behind the number (not
just the top 8), with columns account · owner · **VP** · category/stage · raw · weight · weighted,
**sortable** by clicking the headers. Inside the drawer are **VP and RSD multi-select filters**
(reusing `MultiSelect` + `vpsList`/`teamOwners`/`inScope`/`vpOf`); the header total + % recompute
live as you filter. Each row links into `/deals/[id]`. One generic `WeightedDrawer` serves both
cards via `weightOf`/`basisOf` props. The quick-glance modal is unchanged (kept as the summary).

**Why.** Requested — a full, filterable view of what's inside the weighted number, sliceable by
VP / RSD. (Geography intentionally not added.)

## 2026-06-27 — Weighted Forecast: Pipeline category weight 0.25 → 0.10

**What.** In `fcBucket` (`DealsStats.tsx`), the **Pipeline** forecast-category weight dropped
from 0.25 to **0.10**. Other weights unchanged (Commit 0.90, Upside Key Deal 0.85, Best Case
0.75, other/blank 0.15). Lowers the headline Weighted Forecast and the Pipeline row in its modal.

**Why.** Requested — Pipeline-category deals should be discounted harder.

## 2026-06-27 — Weighted Forecast now open-pipeline only (matches Weighted Pipeline)

**What.** Weighted Forecast (`DealsStats.tsx`) now excludes the same closed/dead stages as
Weighted Pipeline — Closed Won, Closed Lost, Qualified Out, No Decision, Omitted — from both
the weighted sum and the base. Both cards now compute over one shared `openRecs` set, so they
share the same open-pipeline base. The card reads `% of open pipeline` (was `% of pipeline`)
and the modal's total row is "Open pipeline" with the open base + count and a
`N closed/excluded` note. Total Pipeline / Commit / At Risk cards are unchanged.

**Why.** Requested — closed/won/lost/omitted deals shouldn't inflate the weighted forecast.

## 2026-06-27 — New "Weighted Pipeline" card (stage-weighted, open only)

**What.** A 6th stat card, **Weighted Pipeline** (`DealsStats.tsx`), sits next to Weighted
Forecast. It weights each **open** deal's amount by its **stage** (via `stageBucket`):
Qualified 0.10 · Formal Evaluation 0.20 · Shortlisted 0.50 · Vendor Selected 0.75 ·
Contracting (Contract In Progress/Negotiation) 0.80 · Contract Signed & PO Received 1.00 ·
Initial Interest 0. **Open pipeline only** — Closed Won/Lost, Qualified Out, No Decision,
Omitted are excluded from both the weighted sum and the base; the card shows `% of open
pipeline`. Like Weighted Forecast it's click-to-open: the shared `WeightedModal` shows the
per-stage table that totals to the headline figure plus the top weighted contributors (each
links into `/deals/[id]`). The modal markup was factored into one reusable `WeightedModal`
used by both cards. Stats grid widened to 6 columns (responsive: 6 → 3 ≤1320px → 2 ≤760px).

**Why.** Requested — a probability-by-stage view of open pipeline alongside the
forecast-category-weighted view.

## 2026-06-27 — Weighted Forecast card opens a breakdown modal + reweighted

**What.** The Weighted Forecast stat card (`DealsStats.tsx`) is now click-to-open (role=button,
keyboard + Escape support, `view ↗` hint on hover). Clicking opens a centered modal that shows
**how the blended number is reached**: a per-forecast-category table (deals · raw $ · weight ·
weighted $) that totals to the headline figure and % of pipeline, plus the **top weighted
contributors**, each row linking into `/deals/[id]`. The other four cards are unchanged/static.

The category weights were also reset (single source: `bucketOf`): **Commit 0.90, Upside Key Deal
0.85, Best Case 0.75, Pipeline 0.25, other/blank 0.15.** Matching is now case-insensitive and
tolerant — previously the code matched the literal `"Upside"`, so the real `"Upside Key Deal"`
deals silently fell to 0.15; they now correctly weight 0.85. **This changes the headline Weighted
Forecast value** (Best Case + Upside both weight higher now).

**Why.** Requested. The weighted number is the only KPI that isn't a plain sum/filter, so a
click-through that explains the weighting math (and routes to the deals behind it) is the useful
one to make interactive.

## 2026-06-27 — Two more deal filters: Stage + Verdict

**What.** The deals filter bar (`ScopeFilterBar`, `#dealfilters`) gains two multi-select
facets: **"All Stage"** (distinct `hard.stage` values present, ordered by `STAGE_ORDER`, not
alphabetically) and **"All Verdict"** (the momentum verdict via `healthLabel` —
On track / Slowing / Close-date risk / Off track, plus "No verdict" for deals without one).
`DealFilters` grows `stage` and `verdict` arrays (`DashboardContext`), with matching
predicates in the `filtered` memo (`h.stage` exact match; `healthLabel(north_star_verdict)`
match). Empty array = "all", same as the other facets; Clear resets them too. Verdict reads
from the slim list record (`ai.north_star_verdict`), which is already loaded — no extra fetch.
These show wherever the bar shows (deals, espresso, matcha).

**Why.** Requested — lets a VP slice the book by pipeline stage and by deal health before
drilling into a drawer.

## 2026-06-28 — Long to-do rows are capped (more/less) for scannability

**What.** `TodoRow` (`DealTodos.tsx`) renders item text via a new `TodoText` that caps long
items (>30 words — the wordy Moves / Best-practice essays the QI flagged) at ~30 words ending
on a clean clause (`clipWordsClean`), with a **more/less** toggle. Short items render untouched.

**Why.** QI feedback: Best-practice to-dos ran a 60-word median (up to 300); Moves had a long
tail. The action was buried. This keeps the row scannable while the full text stays one click away.

## 2026-06-27 — Play card highlights wrap up cleanly within 30 words

**What.** The deal drawer's "The Play" card (`DealDrawerView.tsx` → `PlayGate`) now shows
each play line as a finished thought capped at 30 words instead of a 12-word clip. The
collapsed line renders via the new `clipWordsClean(full, 30)` (in `lib/engine/helpers.ts`):
capped at 30 words, but never cut mid-sentence and never ending in "…" — if the source runs
longer it trims back to the last sentence (`. ! ?`) or clause (`, ; — –`) boundary inside the
cap, and as a last resort drops a dangling connector word. Source text of ≤30 words shows
whole. The "more/less" toggle is kept but now only appears when the play genuinely exceeds
30 words (was 12), and "more" still reveals the full action + expected effect, so nothing is
lost. No CSS clamp on `.gate-t`, so the line wraps and displays in full.

**Why.** The 12-word clip lopped plays mid-thought (e.g. "Lock the technical win and…"),
which read as broken. Highlights should wrap up cleanly. Only the play/action lines changed;
the verdict headline (26w), champion summary (28w), and SPOF (16w) keep `clipWords`.

## 2026-06-26 — Prospect requirements show a due date + overdue status

**What.** A prospect requirement now renders a timeliness-preserving due chip in
`ContextMeta` (`DealTodos.tsx`): `due <date>` when upcoming, red **`overdue Nd · was <date>`**
when slipped. Unlike the move chips (which always re-plan into the future via `dueInfo`),
a requirement keeps its true date so a missed deliverable is visible. The date comes from
the backend (`act_by`/`due` with `due_source` — a stated deadline or one back-planned from
close); a tooltip distinguishes "stated deadline" from "target — back-planned from close".
Applies to both real `explicitRequirements` items and moves mirrored into the bucket
(`mirroredAsk`). New `.duechip.overdue` style.

**Why.** RevOps needs to track when a buyer-owed deliverable is due and whether we hit it.
Pairs with the backend change of the same date (`derive_todo` now derives the due date from
the close date / stated text — read-time, no re-sweep).

## 2026-06-26 — Every prospect requirement lands in "Prospect requirements"

**What.** Two display-layer routing fixes in `DealTodos.tsx` (`displayBucketOf` + the `DealTodoBuckets`
grouping loop), no re-sweep: (1) **Structured** — `explicitRequirements` items ALWAYS map to the
`prospect` bucket; the old `said_by ? "prospect" : "bestPractice"` gate is gone (an ask the sweep didn't
attribute was being demoted to Best practices and disappearing from the bucket the team tracks). (2)
**Heuristic** — a `critical` (recommended-move) item whose text reads as a prospect-stated ask
(`PROSPECT_ASK_RE`: buyer asked/requested/requires, RFP/RFI/RFQ/BRD *response/deadline/submission/…*,
InfoSec/security questionnaire|review|assessment, "at requested levels", responding to their questions)
is **mirrored** into `prospect` while still showing as a Play card — the one allowed overlap.
Cross-bucket de-dup then keeps the mirrored copy out of Best practices.

**Why.** Prospect requirements looked too sparse (some deals showed 0–2) and the team needs every
buyer-stated deliverable visible in one bucket to track due/owed status. Root cause was display routing,
not data loss: attributed asks were fine, but un-attributed asks and asks the sweep buried inside "moves"
were landing elsewhere. Regex is deliberately conservative (buyer-noun subjects only; RFP needs a real
deliverable qualifier so "manual RFP management" / internal team moves don't false-positive). Validated
on the 62-deal forecast book: 23/314 moves mirrored, all genuine; 0 attributed requirements affected.

## 2026-06-25 — Leaner deal drawer + trustworthy "Commitments by Zycus"

**What.** (1) The drawer reads lighter across all deals: the AI summary lede/body are clipped to ~26/28
words (`clipWords` in `helpers.ts`) and the redundant "The move:" line dropped; to-do item text is
clipped to ~18 words in the shared `DealTodoBuckets` (full text preserved in the data + shown on edit).
(2) **"Commitments made by Zycus"** now drops inferred `implicit`/we-promised items that have **no
grounding quote AND no source** — only genuine, evidence-backed commitments show.

**Why.** The drawer was heavy/verbose; and the commitments bucket was padded with inferred deliverables
we never actually committed to on a call. Pairs with the backend prompt rule (we_promised must be an
explicit, quoted commitment).

## 2026-06-25 — Deal health: FOUR tiers (split At Risk → Close-date risk + Slowing)

**What.** The verdict now renders as four statuses (was three), via the single
`verdictTone`/`healthLabel` helpers (`lib/engine/helpers.ts`):
- On track → green (`v-on`) · **Close-date risk → light green** (`v-cdr`, NEW) · Slowing → amber
  (`v-slow`, NEW) · Off track → red (`v-off`).
- `verdictTone` ORDER matters: "Close Date Risk" contains "risk", so it is caught BEFORE the legacy
  "risk" check; legacy `At Risk` → `v-slow` (amber); unknown → neutral.
New CSS tones `.v-cdr` (`--lgreen-*`) + `.v-slow` in `dashboard.css`. Callers updated: `DealDetailView`
(healthColor), `DealDrawerView` (negative-tone check so Close-date risk reads POSITIVE, not red),
`DealsStats` (the at-risk tile now counts Slowing+Off, **NOT** Close-date risk), deals-list chip.

**Why.** One "At Risk" bucket lumped healthy-but-late deals (McAfee — live POC, only the date slips)
with genuinely stalling deals, making the forecast book read alarmingly red. Close-date risk is a
POSITIVE read (light green) and is excluded from the at-risk tile. Pairs with the backend four-tier
verdict; existing `At Risk` records render as Slowing until re-swept.

## 2026-06-25 — One canonical deal-health label everywhere (kills the "Healthy" drift)

**What.** Added `healthLabel()` in `lib/engine/helpers.ts` as the single source of truth for the three
statuses: On Track → **"On track"**, At Risk → **"At risk"**, Off Track → **"Off track"**, anything else → **"—"**.
Routed every surface through it: `DealDetailView` (was showing "Healthy" in the Deal-health metric but raw
"On Track" in the hero/AI-summary chips and the Verdict field — now all read "On track"), `DealDrawerView`,
and the `runs` admin table. `DealsTab.tsx` is dead code (not mounted anywhere) and left as-is.

**Why.** The same deal rendered different words on different screens ("Healthy" vs "On Track"), which read as
random. Also **hardened `verdictTone()`**: it previously defaulted ANY unrecognised string to green/On-Track, so
a stray verdict wording (Cold / Stalled / Slipping) showed as "Healthy". Now unknown → neutral "—", never
silently green.

**How to work with it.** Use `healthLabel(verdict)` for any new health display — never re-alias inline. The
backend verdict enum is unchanged (`On Track|At Risk|Off Track`); the helper is case-insensitive and tolerates
legacy records. Pairs with the backend's "Verdict definitions locked to three statuses" change.

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
