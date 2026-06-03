import { redis, SETTLEMENT_QUEUE_KEY } from "./redis";

export type SettlementJob = { tradeId: string; expiresAt: string };

export async function scheduleSettlement(tradeId: string, expiresAt: Date): Promise<void> {
  const job: SettlementJob = { tradeId, expiresAt: expiresAt.toISOString() };
  await redis.lpush(SETTLEMENT_QUEUE_KEY, job);
}

export async function pollSettlementQueue(): Promise<SettlementJob | null> {
  return redis.rpop<SettlementJob>(SETTLEMENT_QUEUE_KEY);
}
