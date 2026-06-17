# CLAUDE.md

Read **[AGENTS.md](AGENTS.md)** — the operating guide for any coding agent in this repo
(start-of-session reading order, conventions, copy-paste prompts).

Quick reminders:
- **Read `CHANGELOG.md` first every session** (and after every `git pull`). Append an
  entry when you change behaviour/contracts.
- **Pushing `main` auto-deploys to Vercel** — `npx tsc --noEmit` must be clean first.
- **Agent prompts live in the backend's Supabase** (edit via Admin → Agent Control); the
  `DRAFTING_SYSTEM_PROMPT` in `components/agent/AgentRun.tsx` is a deprecated fallback.
- **Admin-only surfaces gate on `isAdminView`**; admin writes are gated in the
  deal-engine proxy (`app/api/deal-engine/[[...path]]/route.ts`).
