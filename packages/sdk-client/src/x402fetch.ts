/**
 * `x402fetch` — the client half of the x402 loop. It performs a request and, on
 * a `402 Payment Required`, transparently pays the challenge and retries with an
 * `X-PAYMENT` header, returning the final origin `Response`. This is what lets
 * an AI agent pay for an API with a single call.
 *
 *   request → 402 → select requirement (by scheme) → guard max amount →
 *   ensure RLUSD trustline → pay → retry with X-PAYMENT → origin response
 *
 * All wire messages are x402 v1: the 402 body is a
 * `PaymentRequirementsResponse`, `X-PAYMENT` carries the
 * `{ x402Version, scheme, network, payload }` envelope, and
 * `X-PAYMENT-RESPONSE` decodes to a `SettlementResponse`.
 */
import { dropsToXrp } from 'xrpl';
import { Client, Wallet } from 'xrpl';
import {
  Asset,
  PaymentRequirementsSchema,
  SettlementResponseSchema,
  X402Header,
  X402Scheme,
  X402_VERSION,
  decodeHeaderPayload,
  encodeHeaderPayload,
} from '@app/shared';
import type { PaymentPayload, PaymentRequirements, SettlementResponse } from '@app/shared';
import { decimalGte } from './decimal.js';
import { ensureTrustline } from './trustline.js';
import { payChallenge } from './payment.js';
import { hasCredits, signClaim } from './channel.js';
import type { ChannelHandle } from './channel.js';

/** Per-call configuration for {@link x402fetch}, carried on the request init. */
export interface X402Config {
  /** Signing wallet that funds payments. */
  wallet: Wallet;
  /** Connected XRPL client used to submit payments. */
  client: Client;
  /** Team source tag stamped on every payment. */
  sourceTag: number;
  /** Ceiling per call, in human units (XRP / RLUSD), keyed by asset. */
  maxAmount?: Partial<Record<Asset, string>>;
  /** Preferred asset when a challenge offers several ways to pay. */
  preferAsset?: Asset;
  /** Manage the RLUSD trustline automatically before paying (default `true`). */
  manageTrustline?: boolean;
  /**
   * An open PayChan channel. When present and the (XRP) challenge fits within
   * remaining credits, the request is paid off-ledger with a signed claim
   * (the `paychan` scheme) instead of an on-chain Payment. Falls back to the
   * `exact` scheme otherwise.
   */
  channel?: ChannelHandle;
}

/** `fetch` init extended with the x402 payment configuration. */
export interface X402FetchInit extends RequestInit {
  x402: X402Config;
}

/** Thrown when a challenge's price exceeds the caller's configured ceiling. */
export class MaxAmountExceededError extends Error {
  constructor(
    readonly asset: Asset,
    readonly required: string,
    readonly ceiling: string,
  ) {
    super(`challenge requires ${required} ${asset}, above the max of ${ceiling}`);
    this.name = 'MaxAmountExceededError';
  }
}

/** Shape of the 402 challenge body issued by the resource server. */
interface ChallengeBody {
  accepts?: unknown;
}

/** Parse and validate every entry of the 402 `accepts[]`. */
function parseRequirements(body: ChallengeBody): PaymentRequirements[] {
  const { accepts } = body;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error('402 response carried no payment requirements');
  }
  return accepts.map((entry) => PaymentRequirementsSchema.parse(entry));
}

/** Pick the requirement for `scheme`, honouring an asset preference. */
function pickByScheme(
  requirements: PaymentRequirements[],
  scheme: X402Scheme,
  prefer?: Asset,
): PaymentRequirements | undefined {
  const candidates = requirements.filter((requirement) => requirement.scheme === scheme);
  if (prefer) {
    const match = candidates.find((requirement) => requirement.asset === prefer);
    if (match) return match;
  }
  return candidates[0];
}

/** The challenge price expressed in human units, for the max-amount guard. */
function humanAmount(requirements: PaymentRequirements): string {
  return requirements.asset === Asset.XRP
    ? String(dropsToXrp(requirements.maxAmountRequired))
    : requirements.maxAmountRequired;
}

/** Reject an over-priced challenge before any payment is submitted. */
function guardMaxAmount(
  requirements: PaymentRequirements,
  maxAmount: Partial<Record<Asset, string>> | undefined,
): void {
  const ceiling = maxAmount?.[requirements.asset];
  if (ceiling === undefined) return;
  const required = humanAmount(requirements);
  if (!decimalGte(ceiling, required)) {
    throw new MaxAmountExceededError(requirements.asset, required, ceiling);
  }
}

/**
 * Fetch `url`, transparently handling a single 402 payment round. Non-402
 * responses are returned unchanged. The settled tx hash is available on the
 * returned response's `X-PAYMENT-RESPONSE` header via {@link readSettlement}.
 */
export async function x402fetch(
  url: string | URL,
  init: X402FetchInit,
): Promise<Response> {
  const { x402, ...rest } = init;
  // A one-shot ReadableStream body is exhausted by the initial request and
  // cannot be replayed on the paid retry — buffer it up front so every attempt
  // sends the same payload. String/Blob/ArrayBuffer/URLSearchParams bodies are
  // already replayable and pass through untouched.
  const requestInit = await bufferReplayableBody(rest);

  const initial = await fetch(url, requestInit);
  if (initial.status !== 402) return initial;

  const body = (await initial.json()) as ChallengeBody;
  const offered = parseRequirements(body);

  // Fast path: pay off-ledger from an open channel when the seller advertises
  // the `paychan` scheme and remaining credits allow. If the gateway rejects
  // the claim (still 402), fall through to the `exact` scheme.
  const creditsRequirements = pickByScheme(offered, X402Scheme.PAYCHAN);
  if (creditsRequirements && canUseCredits(creditsRequirements, x402.channel)) {
    guardMaxAmount(creditsRequirements, x402.maxAmount);
    const response = await payViaCredits(url, requestInit, x402, creditsRequirements, x402.channel!);
    if (response.status !== 402) return response;
  }

  const requirements = pickByScheme(offered, X402Scheme.EXACT, x402.preferAsset);
  if (!requirements) {
    // Never pay on chain against a credits-only seller — the gateway would
    // reject the scheme after the funds had already moved.
    throw new Error(
      'seller accepts only prepaid credits — open and register a payment channel first',
    );
  }
  guardMaxAmount(requirements, x402.maxAmount);

  if (requirements.asset === Asset.RLUSD && x402.manageTrustline !== false) {
    if (!requirements.extra.issuer) {
      throw new Error('RLUSD challenge is missing the issuer address');
    }
    await ensureTrustline(x402.client, x402.wallet, requirements.extra.issuer);
  }

  const txHash = await payChallenge({
    client: x402.client,
    wallet: x402.wallet,
    requirements,
    sourceTag: x402.sourceTag,
  });

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: X402Scheme.EXACT,
    network: requirements.network,
    payload: {
      nonce: requirements.extra.nonce,
      asset: requirements.asset,
      txHash,
      payer: x402.wallet.classicAddress,
    },
  };

  const headers = new Headers(requestInit.headers);
  headers.set(X402Header.X_PAYMENT, encodeHeaderPayload(payload));
  return fetch(url, { ...requestInit, headers });
}

/**
 * If `init.body` is a one-shot `ReadableStream`, read it fully into a buffer so
 * the request can be sent again on the paid retry. All other body types are
 * already replayable and returned unchanged.
 */
async function bufferReplayableBody(init: RequestInit): Promise<RequestInit> {
  const { body } = init;
  if (body == null || !(body instanceof ReadableStream)) return init;
  const buffered = await new Response(body).arrayBuffer();
  return { ...init, body: buffered };
}

/** Whether the challenge can be paid from `channel`'s remaining credits. */
function canUseCredits(
  requirements: PaymentRequirements,
  channel: ChannelHandle | undefined,
): channel is ChannelHandle {
  if (!channel || requirements.asset !== Asset.XRP) return false;
  return hasCredits(channel, requirements.maxAmountRequired);
}

/**
 * Pay a challenge with a signed PayChan claim. On acceptance (non-402), advance
 * the channel's cumulative counter so the next claim stays strictly monotonic.
 */
async function payViaCredits(
  url: string | URL,
  requestInit: RequestInit,
  x402: X402Config,
  requirements: PaymentRequirements,
  channel: ChannelHandle,
): Promise<Response> {
  const newCumulative = (
    BigInt(channel.cumulativeDrops) + BigInt(requirements.maxAmountRequired)
  ).toString();
  const signature = signClaim(x402.wallet, channel.channelId, newCumulative);

  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: X402Scheme.PAYCHAN,
    network: requirements.network,
    payload: {
      nonce: requirements.extra.nonce,
      asset: Asset.XRP,
      channelId: channel.channelId,
      cumulativeAmount: newCumulative,
      signature,
      payer: x402.wallet.classicAddress,
    },
  };

  const headers = new Headers(requestInit.headers);
  headers.set(X402Header.X_PAYMENT, encodeHeaderPayload(payload));
  const response = await fetch(url, { ...requestInit, headers });

  if (response.status !== 402) channel.cumulativeDrops = newCumulative;
  return response;
}

/** Decode the `X-PAYMENT-RESPONSE` header (settlement result) from a response. */
export function readSettlement(response: Response): SettlementResponse | undefined {
  const header = response.headers.get(X402Header.X_PAYMENT_RESPONSE);
  if (!header) return undefined;
  return SettlementResponseSchema.parse(decodeHeaderPayload(header));
}
