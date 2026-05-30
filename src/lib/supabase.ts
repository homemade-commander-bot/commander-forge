// Optional Supabase browser client. Returns null if env vars are not
// configured — the app falls back to localStorage-only mode (no accounts
// required) in that case.
//
// To enable cloud sync:
//   1. Create a free Supabase project at https://supabase.com
//   2. Add to .env.local (and Vercel env vars):
//        NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
//        NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
//   3. Run the SQL in `supabase/schema.sql` against your project.
//
// Without these env vars the app keeps working exactly as before — accounts
// are an enhancement, not a requirement.
//
// Why @supabase/ssr (not @supabase/supabase-js directly)?
// `createBrowserClient` stores the session in cookies as well as
// localStorage, so the session survives navigations cleanly and the same
// client works if we later add server-rendered, auth-aware pages.

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined = undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    cached = null;
    return null;
  }
  // IMPORTANT: implicit flow (not PKCE) for magic links.
  //
  // PKCE stashes a one-time `code_verifier` in the browser that REQUESTED
  // the link, and only that same browser can complete sign-in. That breaks
  // the most common real-world flow: request the link on a laptop, click it
  // on a phone — or click it from a mobile mail app whose in-app webview
  // doesn't share cookies with the browser you typed your email into. The
  // verifier is absent, the exchange fails, and the user is silently left
  // signed-out.
  //
  // Implicit flow returns the session in the URL fragment (#access_token),
  // which `detectSessionInUrl` (on by default) parses client-side on
  // whatever device opens the link. No per-device secret, so magic links
  // work across devices/browsers. OAuth (Phase 3) also supports implicit.
  cached = createBrowserClient(url, key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return cached;
}

export function isSyncEnabled(): boolean {
  return getSupabase() !== null;
}
