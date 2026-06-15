import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConnection, sfdcConfigured } from "@/lib/sfdc/server";

export const dynamic = "force-dynamic";

// Safe status for the UI — NEVER returns tokens. Tells the gate modal whether to
// prompt, and feeds the "Salesforce connected" line in the user dropdown.
export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ configured: sfdcConfigured(), connected: false, authed: false });
  }
  const conn = await getConnection(data.user.id);
  return NextResponse.json({
    configured: sfdcConfigured(),
    authed: true,
    connected: !!conn,
    sf_username: conn?.sf_username ?? null,
    sf_display_name: conn?.sf_display_name ?? null,
  });
}
