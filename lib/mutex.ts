// Per-key serial executor. Ensures that operations against the same key run
// one-at-a-time within this Node process. Sufficient when there is a single
// Next.js / WS server instance; for multi-instance you'd need a Postgres
// advisory lock or an atomic SQL UPDATE.

const queues = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  queues.set(
    key,
    // ensure the queue entry resolves regardless of fn's outcome so the next
    // waiter always runs
    next.catch(() => undefined),
  );
  // Cleanup once the entry has settled to avoid unbounded growth
  next.finally(() => {
    if (queues.get(key) === next.catch(() => undefined)) {
      // identity comparison won't match because of the .catch wrapper; instead
      // garbage-collect lazily — see below
    }
  }).catch(() => {});
  return next;
}

// Periodic shrink — drops stale entries when the map grows large. Settled
// promises have no observable state from the outside, so we just evict
// LRU-ish (insertion-order) when over the soft cap.
setInterval(() => {
  for (const k of queues.keys()) {
    if (queues.size < 1000) break;
    queues.delete(k);
  }
}, 60_000).unref?.();
