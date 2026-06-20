// Serves the account-logo display map: { slug -> signed Supabase Storage URL }.
// The `account-logos` bucket is PRIVATE, so signing must happen server-side with the
// service-role key (which never reaches the browser). This replaces the build-time
// `lib/engine/accountLogos.ts` map — new logos written by the Apollo enrichment job
// (enrich_account_logos.py) appear automatically on the next cache refresh, with no
// re-run of gen_logo_map.py and no rebuild.
import "server-only";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return _admin;
}

const REFRESH_MS = 60 * 60 * 1000; // re-list + re-sign at most hourly per instance
const SIGN_TTL = 60 * 60 * 24 * 7; // 7-day signed URLs (re-signed each refresh)
let cache: { at: number; logos: Record<string, string> } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.at < REFRESH_MS) {
    return NextResponse.json({ logos: cache.logos, cached: true });
  }
  try {
    const sb = admin();
    const names: string[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage
        .from("account-logos")
        .list("", { limit: 1000, offset });
      if (error || !data || data.length === 0) break;
      for (const o of data) if (o.name.endsWith(".png")) names.push(o.name.slice(0, -4));
      offset += data.length;
      if (data.length < 1000) break;
    }

    const logos: Record<string, string> = {};
    if (names.length) {
      const { data: signed } = await sb.storage
        .from("account-logos")
        .createSignedUrls(names.map((n) => `${n}.png`), SIGN_TTL);
      signed?.forEach((s, i) => {
        if (s.signedUrl) logos[names[i]] = s.signedUrl;
      });
    }

    cache = { at: Date.now(), logos };
    return NextResponse.json({ logos });
  } catch {
    // Fail soft: keep whatever we last had so the UI never loses logos on a hiccup.
    return NextResponse.json({ logos: cache?.logos ?? {} });
  }
}
