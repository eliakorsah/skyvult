import { Redis } from "@upstash/redis";

const URL_  = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** True when Upstash isn't really configured — covers both unset env vars
 *  and the placeholder values that ship in .env / .env.example. With Redis
 *  effectively absent we return a no-op stub instead of constructing the
 *  real client, otherwise every call hangs waiting on a TCP timeout to a
 *  hostname that doesn't resolve. */
const isPlaceholder =
  !URL_ ||
  !TOKEN ||
  URL_.includes("your-redis") ||
  TOKEN === "your-token";

type StubRedis = {
  get:   <T = unknown>(key: string) => Promise<T | null>;
  set:   (...args: unknown[]) => Promise<"OK" | null>;
  del:   (...keys: string[])  => Promise<number>;
  lpush: (...args: unknown[]) => Promise<number>;
  rpush: (...args: unknown[]) => Promise<number>;
  lpop:  (...args: unknown[]) => Promise<unknown>;
  rpop:  <T = unknown>(...args: unknown[]) => Promise<T | null>;
  llen:  (key: string) => Promise<number>;
};

const noopRedis: StubRedis = {
  get:   async () => null,
  set:   async () => null,
  del:   async () => 0,
  lpush: async () => 0,
  rpush: async () => 0,
  lpop:  async () => null,
  rpop:  async () => null,
  llen:  async () => 0,
};

if (isPlaceholder) {
  console.warn("[redis] Upstash not configured — using in-process no-op stub. Rate limits, queue, and price cache fall back to local/DB paths.");
}

// Cast to Redis so call sites keep their generic typing (e.g. redis.get<T>).
// The stub silently returns nulls/zeros for every operation.
export const redis: Redis = isPlaceholder
  ? (noopRedis as unknown as Redis)
  : new Redis({ url: URL_!, token: TOKEN! });

export const KEYS = {
  ticks: (asset: string) => `skyvult:ticks:${asset}`,
  lastPrice: (asset: string) => `skyvult:last:${asset}`,
};

// Key for the cross-process settlement job queue
export const SETTLEMENT_QUEUE_KEY = "skyvult:settlement-queue";
