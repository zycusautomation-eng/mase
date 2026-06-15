// Server-only Salesforce OAuth helpers. Tokens live in public.sf_connections,
// which is RLS-locked with NO client policies — only the service-role client
// here can read/write them, so refresh tokens never reach the browser.
//
// Flow: /api/sfdc/connect -> SF authorize -> /api/sfdc/callback exchanges the
// code for {access_token, refresh_token, instance_url, id} and stores it keyed
// by the Supabase user. The deal-engine proxy refreshes + injects the rep's
// access token into the to-do push so the SF Task is created AS the rep.
import "server-only";
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js";

const SF_LOGIN = (process.env.SFDC_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
const CLIENT_ID = process.env.SFDC_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SFDC_CLIENT_SECRET || "";
// `api` to write Tasks, `refresh_token` so we can keep the session alive without
// re-prompting the rep on every push.
const SCOPE = "api refresh_token";
const SF_API_VERSION = "v60.0";

export function sfdcConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

let _admin: SupabaseClient | null = null;
export function sfAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/sfdc/callback`;
}

// --- PKCE (S256) — required by many External Client Apps, harmless otherwise.
function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}
export async function challengeFromVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(origin: string, state: string, codeChallenge: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: callbackUrl(origin),
    scope: SCOPE,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${SF_LOGIN}/services/oauth2/authorize?${p.toString()}`;
}

interface SfTokenResponse {
  access_token: string;
  refresh_token?: string;
  instance_url: string;
  id: string; // identity URL
  token_type: string;
  scope?: string;
  issued_at?: string;
}

export async function exchangeCode(origin: string, code: string, codeVerifier?: string): Promise<SfTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: callbackUrl(origin),
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);
  const r = await fetch(`${SF_LOGIN}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`SF token exchange failed (${r.status}): ${await r.text()}`);
  return r.json();
}

async function refreshAccess(refreshToken: string): Promise<{ access_token: string; instance_url?: string; scope?: string }> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const r = await fetch(`${SF_LOGIN}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`SF refresh failed (${r.status}): ${await r.text()}`);
  return r.json();
}

export async function fetchIdentity(idUrl: string, accessToken: string): Promise<{ user_id: string; username: string; display_name: string }> {
  const r = await fetch(idUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`SF identity failed (${r.status})`);
  const j = await r.json();
  return { user_id: j.user_id, username: j.username, display_name: j.display_name };
}

export interface SfConnection {
  user_id: string;
  email: string | null;
  sf_user_id: string | null;
  sf_username: string | null;
  sf_display_name: string | null;
  instance_url: string | null;
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
}

export async function getConnection(userId: string): Promise<SfConnection | null> {
  const { data } = await sfAdmin().from("sf_connections").select("*").eq("user_id", userId).maybeSingle();
  return (data as SfConnection) || null;
}

export async function saveConnection(row: Partial<SfConnection>): Promise<void> {
  const { error } = await sfAdmin()
    .from("sf_connections")
    .upsert({ ...row, issued_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw new Error(`store SF connection failed: ${error.message}`);
}

export async function deleteConnection(userId: string): Promise<void> {
  await sfAdmin().from("sf_connections").delete().eq("user_id", userId);
}

// Return a usable access token for a push: refresh via the refresh_token (cheap,
// rare — pushes are human-confirmed) and persist the new token. Falls back to the
// stored token if refresh fails (it may still be valid). null if not connected.
export async function freshAccessToken(userId: string): Promise<{ access_token: string; instance_url: string } | null> {
  const c = await getConnection(userId);
  if (!c) return null;
  if (c.refresh_token) {
    try {
      const t = await refreshAccess(c.refresh_token);
      const instance_url = t.instance_url || c.instance_url || "";
      await sfAdmin()
        .from("sf_connections")
        .update({ access_token: t.access_token, instance_url, issued_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (instance_url) return { access_token: t.access_token, instance_url };
    } catch {
      /* fall through to the stored token */
    }
  }
  if (c.access_token && c.instance_url) return { access_token: c.access_token, instance_url: c.instance_url };
  return null;
}

export { SF_API_VERSION };
