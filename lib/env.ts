// Fail fast on missing required env vars instead of crashing with cryptic
// "supabase URL is undefined" errors at the first DB call.
const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let validated = false;

export function assertEnv(): void {
  if (validated) return;
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    const msg = `Missing required env vars: ${missing.join(", ")}.\n` +
      `Set them in tradeph/.env.local before starting the server.`;
    // Throwing here surfaces the problem at the first import rather than at
    // runtime inside an obscure DB call.
    throw new Error(msg);
  }
  validated = true;
}
