import { NextRequest } from "next/server";
import { createHmac } from "crypto";
import { supabaseAdmin } from "./supabase";
import { isOwnerEmail } from "./owner";
export { OWNER_EMAIL, isOwnerEmail } from "./owner";

// ---------------------------------------------------------------------------
// In-process auth cache — avoids a Supabase Auth API round-trip on every
// request. TTL is 60s: short enough that a blocked user is locked out within
// a minute, long enough to cover rapid burst trading.
// ---------------------------------------------------------------------------
const AUTH_CACHE_TTL = 60_000;
const authCache = new Map<string, { profile: UserProfile; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authCache) if (v.expiresAt < now) authCache.delete(k);
}, 60_000).unref?.();

// ---------------------------------------------------------------------------
// Local JWT verification — when SUPABASE_JWT_SECRET is set we can verify the
// token's HS256 signature without a network round-trip and skip auth.getUser
// entirely. Get the secret from: Supabase Dashboard → Settings → API → JWT.
// ---------------------------------------------------------------------------
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? "";

function verifyJwtLocally(token: string): { sub: string; email: string } | null {
  if (!JWT_SECRET) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const expected = createHmac("sha256", JWT_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");
    if (expected !== parts[2]) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!payload?.sub || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, email: payload.email ?? "" };
  } catch {
    return null;
  }
}

export type UserProfile = {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  blocked: boolean;
};

export function bearer(req: NextRequest | Request): string | null {
  const h = (req as any).headers.get?.("authorization") || "";
  if (!h.startsWith("Bearer ")) return null;
  return h.slice(7);
}

export async function getUserFromRequest(req: NextRequest | Request): Promise<UserProfile | null> {
  const token = bearer(req);
  if (!token) return null;

  // Cache hit — skip all network calls for the lifetime of this token entry.
  const cached = authCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.profile;

  let result: UserProfile | null = null;

  // Fast path: verify JWT signature locally (no network) + one DB query.
  // Requires SUPABASE_JWT_SECRET from Supabase Dashboard → Settings → API.
  const claims = verifyJwtLocally(token);
  if (claims) {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name, role, blocked")
      .eq("id", claims.sub)
      .single();
    if (profile && !profile.blocked) {
      result = {
        id: claims.sub,
        email: claims.email,
        name: profile.name,
        role: profile.role as "USER" | "ADMIN",
        blocked: profile.blocked,
      };
    }
  } else {
    // Slow path: verify via Supabase Auth API. Decode the sub claim from the
    // JWT payload (unverified) so both calls can run in parallel.
    const [{ data: { user }, error }, profileRes] = await Promise.all([
      supabaseAdmin.auth.getUser(token),
      (async () => {
        try {
          const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
          if (!payload?.sub) return { data: null };
          return supabaseAdmin
            .from("profiles")
            .select("name, role, blocked")
            .eq("id", payload.sub)
            .single();
        } catch {
          return { data: null };
        }
      })(),
    ]);
    if (!error && user) {
      const profile = (profileRes as any).data;
      if (profile && !profile.blocked) {
        result = {
          id: user.id,
          email: user.email!,
          name: profile.name,
          role: profile.role as "USER" | "ADMIN",
          blocked: profile.blocked,
        };
      }
    }
  }

  if (result) authCache.set(token, { profile: result, expiresAt: Date.now() + AUTH_CACHE_TTL });
  return result;
}

export async function requireUser(req: NextRequest | Request) {
  const user = await getUserFromRequest(req);
  if (!user) throw new HttpError(401, "Unauthorized");
  return user;
}

export async function requireAdmin(req: NextRequest | Request) {
  const user = await requireUser(req);
  // Two gates: must hold ADMIN role in DB AND match the hardcoded owner
  // email. Either alone is not enough — even a manually-flipped role row
  // can't access the panel from a different address.
  if (user.role !== "ADMIN") throw new HttpError(403, "Forbidden");
  if (!isOwnerEmail(user.email)) throw new HttpError(403, "Forbidden");
  return user;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
