# Deal Intelligence Engine — Frontend (Next.js)

Next.js App Router frontend for the Deal Intelligence Engine. Connects to the
FastAPI backend on Replit through a **server-side proxy** so the Bearer token
never reaches the browser.

## How the connection works
- The browser only ever calls same-origin `/api/deal-engine/*`.
- `app/api/deal-engine/[[...path]]/route.ts` attaches `Authorization: Bearer <token>`
  (from a server-side env var) and forwards to `DEAL_ENGINE_API_BASE/api/deal-engine/*`.
- `lib/api.ts` is the typed client wrapper; every call checks `res.ok` and surfaces `{ error }`.

## Setup
```bash
cd frontend
npm install
cp .env.local.example .env.local   # then fill in the two values
npm run dev                         # http://localhost:3000
```

`.env.local` (already created locally, git-ignored):
```
DEAL_ENGINE_API_BASE=https://...replit.dev   # bare host, no /api path
DEAL_ENGINE_TOKEN=<bearer token / DISPATCH_SECRET>   # server-side only, never NEXT_PUBLIC_
```
To point at production later, just change `DEAL_ENGINE_API_BASE` to the `.replit.app` URL.

## Tabs
- **Deals** — `/opportunities`, table + click-through detail (verdict, recommended moves).
- **Espresso** — `/todo`, grouped critical / important / requirements / implicit / best-practice.
- **Matcha** — `/matcha`, coverage-vs-target bars, stage funnel, NAA by month, stalled-deals table.
- **Chat** — `/chat`, full conversation resent each turn, scopable to an RSD.

Owner filter values come from `/team`. Every tab has loading, empty, and error states
(the book may be empty — `record_count: 0`).

## Corporate TLS inspection (important on the Zycus network)
The dev/build/start scripts run Node with `--use-system-ca` (via `cross-env` +
`NODE_OPTIONS`). Behind a TLS-inspection proxy, Node's default CA bundle rejects the
re-signed certificate and server-side `fetch` fails with
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` (the proxy returns `502 fetch failed`).
`--use-system-ca` makes Node trust the Windows certificate store, where the corporate
root CA lives. It is harmless off-network and in production, so it stays on everywhere.
If you ever run `next` directly (not via npm), pass `--use-system-ca` yourself or set
`NODE_EXTRA_CA_CERTS` to the corporate root PEM.
