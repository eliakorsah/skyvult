import { createClient } from "@supabase/supabase-js";
import { assertEnv } from "./env";

assertEnv();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Node.js < 22 has no native WebSocket — supply the ws package so Supabase
// realtime doesn't throw on server startup.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const wsImpl = typeof WebSocket === "undefined" ? require("ws") : undefined;

const wsOptions = wsImpl ? { realtime: { transport: wsImpl } } : {};

// Anon client — used for signUp / signInWithPassword only
export const supabase = createClient(URL, ANON, wsOptions);

// Service-role admin client — bypasses RLS, used for all server-side DB work
export const supabaseAdmin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
  ...wsOptions,
});
