import { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// In-memory fallback when Upstash credentials are not configured.
const memBuckets = new Map<string, { count: number; resetAt: number }>();

function inMemoryLimit(key: string, max: number, windowMs: number): { success: boolean; reset: number } {
  const now = Date.now();
  const b = memBuckets.get(key);
  if (!b || b.resetAt < now) {
    memBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { success: true, reset: now + windowMs };
  }
  if (b.count >= max) return { success: false, reset: b.resetAt };
  b.count += 1;
  return { success: true, reset: b.resetAt };
}

let upstashLimiters: Map<string, Ratelimit> | null = null;

function getUpstashLimiter(name: string, max: number, windowSec: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || url.includes("your-redis") || token.includes("your-token")) return null;
  if (!upstashLimiters) upstashLimiters = new Map();
  const key = `${name}:${max}:${windowSec}`;
  let lim = upstashLimiters.get(key);
  if (!lim) {
    const redis = new Redis({ url, token });
    lim = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${windowSec} s`),
      prefix: `skyvult:rl:${name}`,
    });
    upstashLimiters.set(key, lim);
  }
  return lim;
}

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

/** Returns true when the request is allowed. */
export async function checkLimit(
  req: NextRequest,
  bucket: string,
  max: number,
  windowSec: number,
  extraKey?: string,
): Promise<{ success: boolean; reset: number }> {
  const ip = getClientIp(req);
  const id = extraKey ? `${ip}:${extraKey}` : ip;
  const lim = getUpstashLimiter(bucket, max, windowSec);
  if (lim) {
    const r = await lim.limit(id);
    return { success: r.success, reset: r.reset };
  }
  return inMemoryLimit(`${bucket}:${id}`, max, windowSec * 1000);
}
