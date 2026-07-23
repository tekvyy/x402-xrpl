/**
 * Typed client for the gateway usage endpoints (US-005). Response shapes mirror
 * the gateway repositories exactly so the dashboard and backend stay in lockstep.
 */
import type { Asset, PaymentMode, PaymentSetup, XrplNetwork } from '@app/shared';
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
  /** Which payment modes this seller accepts. */
  paymentMode: PaymentSetup;
  /** Networks this seller is advertised on. */
  networks: XrplNetwork[];
  /** Networks the gateway can actually take payment on right now. */
  payableNetworks: XrplNetwork[];
}

/** One publicly listed service from `GET /catalog`. */
export interface CatalogService {
  sellerId: string;
  name: string;
  originUrl: string;
  payToAddress: string;
  priceAmount: string;
  priceAsset: Asset;
  paymentMode: PaymentSetup;
  networks: XrplNetwork[];
  payableNetworks: XrplNetwork[];
  /**
   * Where a prepaid PayChan channel must be opened, keyed by network — the
   * gateway holds a different wallet on each ledger.
   */
  channelDestinations: Partial<Record<XrplNetwork, string>>;
  platformFeeBps: number;
}

/** `GET /catalog` response: the public service registry agents discover from. */
export interface Catalog {
  /** Every network this gateway serves. */
  networks: XrplNetwork[];
  facilitator: string;
  services: CatalogService[];
}

/** Fetch the public service catalog (no auth). */
export async function fetchCatalog(): Promise<Catalog> {
  const response = await fetch(`${GATEWAY_URL}/catalog`);
  if (!response.ok) throw new ApiError(`Gateway responded ${response.status}`, response.status);
  return (await response.json()) as Catalog;
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
  /** Network this call was paid on; drives the explorer link. */
  network: XrplNetwork;
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

export function fetchSummary(
  token: string,
  sellerId: string,
  signal?: AbortSignal,
): Promise<UsageSummary> {
  return authed<UsageSummary>(`/usage/summary?sellerId=${encodeURIComponent(sellerId)}`, token, {
    signal,
  });
}

export async function fetchTopEndpoints(
  token: string,
  sellerId: string,
  signal?: AbortSignal,
): Promise<EndpointUsage[]> {
  const data = await authed<{ endpoints: EndpointUsage[] }>(
    `/usage/top-endpoints?sellerId=${encodeURIComponent(sellerId)}`,
    token,
    { signal },
  );
  return data.endpoints;
}

export async function fetchByWallet(
  token: string,
  sellerId: string,
  signal?: AbortSignal,
): Promise<WalletUsage[]> {
  const data = await authed<{ wallets: WalletUsage[] }>(
    `/usage/by-wallet?sellerId=${encodeURIComponent(sellerId)}`,
    token,
    { signal },
  );
  return data.wallets;
}

/**
 * Full SSE URL for a seller's live usage stream. The session token rides in a
 * query param because `EventSource` cannot send an `Authorization` header.
 */
export function usageStreamUrl(token: string, sellerId: string): string {
  return `${GATEWAY_URL}/usage/stream?sellerId=${encodeURIComponent(
    sellerId,
  )}&token=${encodeURIComponent(token)}`;
}

// --- Sign-in-with-XRPL handshake --------------------------------------------

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `Gateway responded ${response.status}`;
    try {
      const b = (await response.json()) as { error?: string };
      if (b.error) detail = b.error;
    } catch {
      // keep default
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

/** Request a sign-in challenge for an address. */
export function requestAuthChallenge(
  address: string,
): Promise<{ message: string; nonce: string; expiresAt: number }> {
  return postJson('/auth/challenge', { address });
}

/** Exchange a wallet-signed challenge transaction for a session token. */
export function verifyAuthTx(
  address: string,
  nonce: string,
  txBlob: string,
): Promise<{ token: string; address: string; expiresAt: number }> {
  return postJson('/auth/verify-tx', { address, nonce, txBlob });
}

// --- Authenticated endpoints (sign-in-with-XRPL bearer token) ---------------

/** Raised specifically on a 401 so the shell can drop an invalid session. */
export class UnauthorizedError extends ApiError {
  constructor() {
    super('session expired', 401);
    this.name = 'UnauthorizedError';
  }
}

async function authed<T>(
  path: string,
  token: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    let detail = `Gateway responded ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // keep default detail
    }
    throw new ApiError(detail, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Input for registering a new API (seller). */
export interface CreateSellerInput {
  name: string;
  originUrl: string;
  payToAddress: string;
  priceAmount: string;
  priceAsset: Asset;
  paymentMode: PaymentSetup;
  /** Networks to advertise on; at least one. */
  networks: XrplNetwork[];
}

export function createApi(token: string, input: CreateSellerInput): Promise<{ sellerId: string }> {
  return authed('/sellers', token, { method: 'POST', body: input });
}

export async function fetchMySellers(token: string): Promise<SellerInfo[]> {
  const data = await authed<{ sellers: SellerInfo[] }>('/sellers', token);
  return data.sellers;
}

/** A saved bot configuration (self-custody; never holds a seed). */
export interface Bot {
  id: string;
  label: string;
  sellerId: string;
  walletAddress: string;
  /** Network this bot pays on. */
  network: XrplNetwork;
  asset: Asset;
  paymentMode: PaymentMode;
  resource: string;
  sourceTag: number;
  maxAmount: string | null;
  depositAmount: string | null;
  meteredCalls: number;
  createdAt: string;
}

/** Bot detail with on-chain spend attributed to its wallet. */
export interface BotWithUsage extends Bot {
  /** The seller's API base URL the bot buys from. */
  serviceUrl: string | null;
  usage: { calls: number; spend: string };
}

/** Input for creating a bot. */
export interface CreateBotInput {
  label: string;
  sellerId: string;
  walletAddress: string;
  asset: Asset;
  paymentMode: PaymentMode;
  resource: string;
  maxAmount?: string;
  depositAmount?: string;
  meteredCalls: number;
}

export function createBot(token: string, input: CreateBotInput): Promise<Bot> {
  return authed('/bots', token, { method: 'POST', body: input });
}

export async function fetchMyBots(token: string): Promise<Bot[]> {
  const data = await authed<{ bots: Bot[] }>('/bots', token);
  return data.bots;
}

export function fetchBot(token: string, id: string): Promise<BotWithUsage> {
  return authed(`/bots/${encodeURIComponent(id)}`, token);
}

export function fetchBotConfig(
  token: string,
  id: string,
): Promise<{ env: string; runCommand: string }> {
  return authed(`/bots/${encodeURIComponent(id)}/config`, token);
}

export function deleteBot(token: string, id: string): Promise<void> {
  return authed(`/bots/${encodeURIComponent(id)}`, token, { method: 'DELETE' });
}
