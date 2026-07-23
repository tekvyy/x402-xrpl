/**
 * Usage streaming: the bridge between a settled `usage_events` row and the live
 * dashboard feed. Each settlement publishes a normalized event to a per-seller
 * Redis pub/sub channel; the `/usage/stream` SSE route subscribes and forwards.
 * Keeping the channel name and event shape here means the publisher (settle /
 * escrow paths) and the subscriber (the route) stay in lockstep.
 */
import type { Redis } from 'ioredis';
import type { Asset, PaymentMode, XrplNetwork } from '@app/shared';
import type { UsageEventRow } from '../db/types.js';

/** The wire shape a dashboard receives on the live feed. */
export interface UsageStreamEvent {
  id: string;
  sellerId: string;
  walletAddress: string;
  endpoint: string;
  /** Amount in the asset's human unit. */
  amount: string;
  asset: Asset;
  mode: PaymentMode;
  /** Network this call was paid on; the feed links to that ledger's explorer. */
  network: XrplNetwork;
  /** On-chain settlement hash, when one exists (null for off-ledger credits). */
  txHash: string | null;
  /** ISO-8601 settlement timestamp. */
  timestamp: string;
}

/** Per-seller pub/sub channel so a dashboard only sees its own seller's feed. */
export function usageChannelName(sellerId: string): string {
  return `usage:stream:${sellerId}`;
}

/** Normalize a persisted usage row into the live-feed event shape. */
export function toStreamEvent(row: UsageEventRow): UsageStreamEvent {
  return {
    id: row.id,
    sellerId: row.seller_id,
    walletAddress: row.wallet_address,
    endpoint: row.endpoint,
    amount: row.amount,
    asset: row.asset,
    mode: row.mode,
    network: row.network,
    txHash: row.tx_hash,
    timestamp: new Date(row.created_at).toISOString(),
  };
}

/** Publish a freshly inserted usage event to its seller's live feed. */
export async function publishUsageEvent(redis: Redis, row: UsageEventRow): Promise<void> {
  await redis.publish(usageChannelName(row.seller_id), JSON.stringify(toStreamEvent(row)));
}
