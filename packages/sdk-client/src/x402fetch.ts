/**
 * `x402fetch` — the client half of the x402 loop. It performs a request and, on
 * a `402 Payment Required`, transparently pays the challenge and retries with an
 * `X-PAYMENT` header, returning the final origin `Response`. This is what lets
 * an AI agent pay for an API with a single call.
 *
 *   request → 402 → select requirement → guard max amount →
 *   ensure RLUSD trustline → pay → retry with X-PAYMENT → origin response
 */
import { dropsToXrp } from 'xrpl';
import { Client, Wallet } from 'xrpl';
import {
  Asset,
  PaymentMode,
  PaymentRequirementsSchema,
  PaymentResponseSchema,
  X402Header,
  decodeHeaderPayload,
  encodeHeaderPayload,
} from '@app/shared';
import type { PaymentRequirements, PaymentResponse, PayPerCallPayload } from '@app/shared';
import { decimalGte } from './decimal.js';
import { ensureTrustline } from './trustline.js';
import { payChallenge } from './payment.js';

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

/** Shape of the 402 challenge body issued by the gateway. */
interface ChallengeBody {
  accepts?: unknown;
}

/** Pick a payable requirement from the 402 `accepts[]`, honouring a preference. */
function selectRequirement(body: ChallengeBody, prefer?: Asset): PaymentRequirements {
  const { accepts } = body;
  if (!Array.isArray(accepts) || accepts.length === 0) {
    throw new Error('402 response carried no payment requirements');
  }
  const requirements = accepts.map((entry) => PaymentRequirementsSchema.parse(entry));
  if (prefer) {
    const match = requirements.find((requirement) => requirement.asset === prefer);
    if (match) return match;
  }
  return requirements[0]!;
}

/** The challenge price expressed in human units, for the max-amount guard. */
function humanAmount(requirements: PaymentRequirements): string {
  return requirements.asset === Asset.XRP
    ? String(dropsToXrp(requirements.amount))
    : requirements.amount;
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
  const { x402, ...requestInit } = init;

  const initial = await fetch(url, requestInit);
  if (initial.status !== 402) return initial;

  const body = (await initial.json()) as ChallengeBody;
  const requirements = selectRequirement(body, x402.preferAsset);
  guardMaxAmount(requirements, x402.maxAmount);

  if (requirements.asset === Asset.RLUSD && x402.manageTrustline !== false) {
    if (!requirements.issuer) throw new Error('RLUSD challenge is missing the issuer address');
    await ensureTrustline(x402.client, x402.wallet, requirements.issuer);
  }

  const txHash = await payChallenge({
    client: x402.client,
    wallet: x402.wallet,
    requirements,
    sourceTag: x402.sourceTag,
  });

  const payload: PayPerCallPayload = {
    mode: PaymentMode.PAY_PER_CALL,
    asset: requirements.asset,
    nonce: requirements.nonce,
    txHash,
    payer: x402.wallet.classicAddress,
  };

  const headers = new Headers(requestInit.headers);
  headers.set(X402Header.X_PAYMENT, encodeHeaderPayload(payload));
  return fetch(url, { ...requestInit, headers });
}

/** Decode the `X-PAYMENT-RESPONSE` header (settlement result) from a response. */
export function readSettlement(response: Response): PaymentResponse | undefined {
  const header = response.headers.get(X402Header.X_PAYMENT_RESPONSE);
  if (!header) return undefined;
  return PaymentResponseSchema.parse(decodeHeaderPayload(header));
}
