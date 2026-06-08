// Browser-side Supabase client. Safe to use in Client Components — it only ever
// holds the public publishable key. Used for the sign-in button (signInWithOAuth)
// and reading the current user in the header.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
