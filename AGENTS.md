# AGENTS.md — operating guide for coding agents (MASE frontend)

You are an AI coding agent working in the MASE frontend (Next.js on Vercel). This is
your standing brief — read it at the **start of every session**, then follow it.

MASE is an enterprise B2B revops app (target ~1000 concurrent users). The frontend
proxies to the FastAPI backend under `/api/deal-engine/*` with one shared Bearer token
and does per-user admin gating itself.

---

## 1. START HERE every session (in this order)

1. **`CHANGELOG.md`** — newest entries. The running log of behaviour/contract changes;
   re-read after every `git pull`. If you read one thing, read this.
2. The backend's conventions also apply to contracts you call — when in doubt, check the
   `mase_backend` repo's `CHANGELOG.md` / `AGENTS.md`.

## 2. Standing conventions (do not violate)

- **Pushing `main` auto-deploys to Vercel.** A commit to `main` IS a production deploy.
  Make sure `npx tsc --noEmit` is clean before you push.
- **Agent prompts live in the backend's Supabase**, edited from Admin → Agent Control.
  Do NOT hardcode prompts in the frontend. The `DRAFTING_SYSTEM_PROMPT` constant in
  `components/agent/AgentRun.tsx` is a DEPRECATED offline fallback only — the live prompt
  is fetched from `/api/deal-engine/todo-runner/prompt`.
- **Admin-only surfaces gate on `isAdminView`** (`realIsAdmin && !simEmail`) so they hide
  while an admin simulates a rep/VP. Admin-only WRITES must ALSO be gated server-side in
  the deal-engine proxy (`app/api/deal-engine/[[...path]]/route.ts`) — the backend trusts
  the shared token, so the proxy is the real per-user gate.
- Never commit secrets; `.env*` stays gitignored.

## 3. When you change something (leave a trail)

1. **Append a `CHANGELOG.md` entry** for any behaviour/contract change
   (`## YYYY-MM-DD — <title>`, then What / Why / How to work with it).
2. **Verify before push:** `npx tsc --noEmit` is clean (the Vercel build type-checks).
3. Keep changes scoped; clear commit messages. Remember: pushing `main` = deploying.

## 4. Copy-paste prompts

**▶ Session start / after `git pull` (catch-up):**
```
Read AGENTS.md and CHANGELOG.md (newest entries). Summarise recent behaviour/contract
changes and the standing conventions, then tell me how they affect this task: <task>.
Flag conflicts (e.g. hardcoding a prompt instead of using the Supabase-backed endpoint,
or an admin write not gated at the proxy).
```

**▶ I just pulled — what changed?:**
```
Run `git log --oneline @{1}..HEAD` and show the CHANGELOG.md diff for that range.
Summarise what changed and whether any of it touches the files/components I work on.
```

**▶ Before you commit/push (wrap-up):**
```
Before pushing: (1) append a CHANGELOG.md entry for any behaviour/contract change;
(2) run `npx tsc --noEmit` and confirm it's clean; (3) confirm no hardcoded prompts and
that any admin-only write is gated in the deal-engine proxy. Remember pushing main
deploys to Vercel. Then write a clear commit message.
```
