// Server-only read client for the Avoma DATALAKE (a separate Supabase project that
// holds 2 years of meetings/transcripts). Used by the admin "Calls" explorer. Reads
// DATALAKE_URL + DATALAKE_SERVICE_KEY from the server env (never exposed to the
// browser). Query-only — PostgREST GET against the avoma_meetings table.
import "server-only";

// The datalake URL is a public Supabase project URL — accept either the server var
// or the NEXT_PUBLIC_ one (whichever is configured). The SERVICE KEY is server-only.
const URL_ = (process.env.DATALAKE_URL || process.env.NEXT_PUBLIC_DATALAKE_URL || "").replace(/\/$/, "");
const KEY = process.env.DATALAKE_SERVICE_KEY || "";

export function datalakeConfigured(): boolean {
  return !!(URL_ && KEY);
}

export type DatalakeCall = {
  uuid: string;
  subject: string | null;
  start_at: string | null;
  is_internal: boolean | null;
  is_call: boolean | null;
  state: string | null;
  transcript_ready: boolean | null;
  duration: number | null;
  crm_opportunity_id: string | null;
  crm_account_id: string | null;
  attendee_domains: string[] | null;
};

const SELECT =
  "uuid,subject,start_at,is_internal,is_call,state,transcript_ready,duration,crm_opportunity_id,crm_account_id,attendee_domains";

export async function queryMeetings(opts: {
  from?: string; to?: string; oppId?: string; subject?: string;
  includeInternal?: boolean; includeCancelled?: boolean; limit?: number;
}): Promise<DatalakeCall[]> {
  if (!datalakeConfigured()) {
    throw new Error("Datalake not configured on the server (set DATALAKE_URL + DATALAKE_SERVICE_KEY).");
  }
  const limit = Math.min(Math.max(opts.limit || 500, 1), 2000);
  let qs = `select=${SELECT}&order=start_at.desc&limit=${limit}`;
  if (opts.from) qs += `&start_at=gte.${encodeURIComponent(opts.from)}T00:00:00`;
  if (opts.to) qs += `&start_at=lte.${encodeURIComponent(opts.to)}T23:59:59`;
  if (opts.oppId) qs += `&crm_opportunity_id=ilike.${encodeURIComponent(opts.oppId.trim().slice(0, 15))}*`;
  if (opts.subject) qs += `&subject=ilike.*${encodeURIComponent(opts.subject.trim())}*`;
  if (!opts.includeInternal) qs += `&is_internal=eq.false`;
  if (!opts.includeCancelled) qs += `&state=neq.cancelled`;

  const r = await fetch(`${URL_}/rest/v1/avoma_meetings?${qs}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`datalake ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
