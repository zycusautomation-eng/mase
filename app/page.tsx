import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  // When Supabase auth is not configured (env vars absent), degrade to opening the
  // app directly rather than constructing the server client (which throws). Mirrors
  // the middleware/AuthButton "misconfig => no gate, not a 500" stance.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    redirect("/deals");
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  redirect(user ? "/deals" : "/login");
}
