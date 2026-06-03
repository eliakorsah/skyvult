"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Browser-only Supabase client (anon key). Used purely for the OAuth
 *  sign-in dance (Google / Facebook) — signInWithOAuth stores the PKCE
 *  verifier and the callback page exchanges the code for a session.
 *
 *  Kept separate from lib/supabase.ts because that module also instantiates
 *  the service-role admin client, which must never reach the browser bundle.
 *  Lazy singleton so the same instance handles both halves of the PKCE flow. */
let _client: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    },
  );
  return _client;
}
