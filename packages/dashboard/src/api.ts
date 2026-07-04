/**
 * Typed client for the gateway usage endpoints (US-005). Response shapes mirror
 * the gateway repositories exactly so the dashboard and backend stay in lockstep.
 */
import type { Asset, PaymentMode } from '@app/shared';
import { GATEWAY_URL } from './config.js';

/** Revenue rolled up per settlement asset. */
export interface AssetRevenue {
  asset: Asset;
  /** Summed amount in the asset's human unit, as a decimal string. */
  amount: string;
  calls: number;
}

/** `GET /usage/summary` response. */
export interface UsageSummary {
  totalCalls: number;
  activeWallets: number;
  revenueByAsset: AssetRevenue[];
}

/** One row of `GET /usage/top-endpoints`. */
export interface EndpointUsage {
  endpoint: string;
  calls: number;
  /** Summed amount across all assets (human unit), as a decimal string. */
  revenue: string;
}

/** One row of `GET /usage/by-wallet`. */
export interface WalletUsage {
  walletAddress: string;
  calls: number;
  /** Summed spend across all assets (human unit), as a decimal string. */
  spend: string;
}

/** A settled seller identity (subset of `GET /sellers/:id`). */
export interface SellerInfo {
  sellerId: string;
  name: string;
  originUrl: string;
  payToAddress: string;
  priceAmount: string;
  priceAsset: Asset;
  paymentMode: PaymentMode;
  gatewayUrl: string;
}

/** Live-feed event pushed over `GET /usage/stream` (SSE). */
export interface UsageStreamEvent {
  id: string;
  sellerId: string;
  walletAddress: string;
  endpoint: string;
  amount: string;
  asset: Asset;
  mode: PaymentMode;
  txHash: string | null;
  timestamp: string;
}

/** Raised when the gateway returns a non-2xx response. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, { signal });
  if (!response.ok) {
    throw new ApiError(`Gateway responded ${response.status} for ${path}`, response.status);
  }
  return (await response.json()) as T;
}

export function fetchSeller(sellerId: string, signal?: AbortSignal): Promise<SellerInfo> {
  return getJson<SellerInfo>(`/sellers/${encodeURIComponent(sellerId)}`, signal);
}

export function fetchSummary(sellerId: string, signal?: AbortSignal): Promise<UsageSummary> {
  return getJson<UsageSummary>(`/usage/summary?sellerId=${encodeURIComponent(sellerId)}`, signal);
}

export async function fetchTopEndpoints(
  sellerId: string,
  signal?: AbortSignal,
): Promise<EndpointUsage[]> {
  const data = await getJson<{ endpoints: EndpointUsage[] }>(
    `/usage/top-endpoints?sellerId=${encodeURIComponent(sellerId)}`,
    signal,
  );
  return data.endpoints;
}

export async function fetchByWallet(
  sellerId: string,
  signal?: AbortSignal,
): Promise<WalletUsage[]> {
  const data = await getJson<{ wallets: WalletUsage[] }>(
    `/usage/by-wallet?sellerId=${encodeURIComponent(sellerId)}`,
    signal,
  );
  return data.wallets;
}

/** Full SSE URL for a seller's live usage stream. */
export function usageStreamUrl(sellerId: string): string {
  return `${GATEWAY_URL}/usage/stream?sellerId=${encodeURIComponent(sellerId)}`;
}
