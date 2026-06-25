/** Maps a raw `trades` row to the client-facing shape. Lives in lib (not in a
 *  route file) because Next route modules may only export HTTP handlers and a
 *  few config keys — exporting a helper from route.ts fails `next build`. */
export function serializeTrade(t: Record<string, any>) {
  return {
    id: t.id,
    asset: t.asset,
    direction: t.direction,
    amount: Number(t.amount),
    entryPrice: Number(t.entry_price),
    exitPrice: t.exit_price != null ? Number(t.exit_price) : null,
    tpPrice:   t.tp_price != null ? Number(t.tp_price) : null,
    slPrice:   t.sl_price != null ? Number(t.sl_price) : null,
    expirySeconds: t.expiry_seconds,
    expiresAt: t.expires_at,
    status: t.status,
    payout: Number(t.payout),
    isDemo: t.is_demo,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
  };
}
