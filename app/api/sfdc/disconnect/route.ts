import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteConnection } from "@/lib/sfdc/server";

export const dynamic = "force-dynamic";

// Forget the rep's Salesforce connection (Disconnect in the user dropdown).
export async function POST() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ ok: false }, { status: 401 });
  await deleteConnection(data.user.id);
  return NextResponse.json({ ok: true });
}
