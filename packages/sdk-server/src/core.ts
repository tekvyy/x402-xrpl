/**
 * Framework-neutral heart of the `x402` middleware. Both the Express and
 * Fastify adapters call {@link decide} and translate its verdict into their own
 * response objects — the x402 protocol logic lives here exactly once.
 *
 *   no X-PAYMENT  → ask the facilitator for a challenge, answer 402 with the
 *                   spec `PaymentRequirementsResponse`
 *   X-PAYMENT     → decode the spec envelope, hand it with its issued
 *                   `PaymentRequirements` to the facilitator's /settle; on
 *                   success, let the route run and attach X-PAYMENT-RESPONSE;
 *                   else answer 402
 *
 * The facilitator `/settle` body is the spec's `{ x402Version, paymentPayload,
 * paymentRequirements }`, so the middleware remembers the requirements it
 * issued per challenge nonce until they expire or settle. A cache miss (e.g.
 * process restart) simply re-challenges the client.
 */
import {
  PaymentRequirementsResponseSchema,
  SettlementResponseSchema,
  X402ErrorCode,
  X402Header,
  X402_VERSION,
  parsePaymentHeader,
  encodeHeaderPayload,
} from '@app/shared';
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentRequirementsResponse,
  SettlementResponse,
} from '@app/shared';
import type { X402MiddlewareOptions } from './types.js';

/** A framework-agnostic instruction for the adapter to carry out. */
export type X402Decision =
  /** Payment is valid — run the route, then attach this settlement header. */
  | { readonly kind: 'proceed'; readonly paymentResponseHeader: string }
  /** No/invalid payment — answer with this status, body, and optional header. */
  | {
      readonly kind: 'respond';
      readonly status: number;
      readonly body: unknown;
      readonly paymentResponseHeader?: string;
    };

/**
 * Requirements issued per challenge nonce, kept until settled or expired so the
 * paid retry can be settled with the exact `PaymentRequirements` the client was
 * shown. Keyed by nonce (UUIDs), so one process-wide map is safe even with
 * several middleware instances.
 */
const issuedChallenges = new Map<string, { accepts: PaymentRequirements[]; expiresAtMs: number }>();

function pruneExpiredChallenges(nowMs: number): void {
  for (const [nonce, entry] of issuedChallenges) {
    if (entry.expiresAtMs <= nowMs) issuedChallenges.delete(nonce);
  }
}

function rememberChallenge(challenge: PaymentRequirementsResponse): void {
  const nowMs = Date.now();
  pruneExpiredChallenges(nowMs);
  const [first] = challenge.accepts;
  if (!first) return;
  issuedChallenges.set(first.extra.nonce, {
    accepts: challenge.accepts,
    expiresAtMs: nowMs + first.maxTimeoutSeconds * 1000,
  });
}

function resolveFetch(options: X402MiddlewareOptions): typeof fetch {
  const impl = options.fetchImpl ?? globalThis.fetch;
  if (!impl) throw new Error('no fetch implementation available; pass options.fetchImpl');
  return impl;
}

function base(options: X402MiddlewareOptions): string {
  return options.gatewayUrl.replace(/\/+$/, '');
}

/**
 * Facilitator-call timeout. Without it, a hung or slow gateway would make every
 * metered request on the seller's app hang indefinitely (resource exhaustion).
 * On timeout the fetch rejects and the caller fails closed — the route never runs.
 */
const FACILITATOR_TIMEOUT_MS = 10_000;

/** Ask the facilitator to issue a single-use challenge for `resource`. */
async function requestChallenge(
  options: X402MiddlewareOptions,
  resource: string,
): Promise<PaymentRequirementsResponse> {
  const response = await resolveFetch(options)(`${base(options)}/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sellerId: options.sellerId, resource }),
    signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`facilitator challenge failed (${response.status})`);
  }
  const challenge = PaymentRequirementsResponseSchema.parse(await response.json());
  rememberChallenge(challenge);
  return challenge;
}

/** Hand a payment + its issued requirements to `/settle`; return the verdict. */
async function settlePayment(
  options: X402MiddlewareOptions,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
): Promise<SettlementResponse> {
  const response = await resolveFetch(options)(`${base(options)}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ x402Version: X402_VERSION, paymentPayload, paymentRequirements }),
    signal: AbortSignal.timeout(FACILITATOR_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`facilitator settle failed (${response.status})`);
  }
  return SettlementResponseSchema.parse(await response.json());
}

/** Issue a fresh challenge and answer 402 with `error` in the spec body. */
async function respondWithChallenge(
  options: X402MiddlewareOptions,
  resource: string,
  error: string,
  paymentResponseHeader?: string,
): Promise<X402Decision> {
  const challenge = await requestChallenge(options, resource);
  return {
    kind: 'respond',
    status: 402,
    paymentResponseHeader,
    body: { ...challenge, error },
  };
}

/**
 * Decide what to do with one incoming request given its `X-PAYMENT` header
 * (undefined when absent). Pure of any framework type so both adapters share it.
 */
export async function decide(
  options: X402MiddlewareOptions,
  requestPath: string,
  paymentHeader: string | undefined,
): Promise<X402Decision> {
  const resource = (options.resource ?? ((path) => path))(requestPath);

  if (!paymentHeader || paymentHeader.length === 0) {
    return respondWithChallenge(options, resource, 'X-PAYMENT header is required');
  }

  let payment: PaymentPayload;
  try {
    payment = parsePaymentHeader(paymentHeader);
  } catch {
    return {
      kind: 'respond',
      status: 400,
      body: { x402Version: X402_VERSION, error: X402ErrorCode.INVALID_PAYLOAD },
    };
  }

  const issued = issuedChallenges.get(payment.payload.nonce);
  const requirements = issued?.accepts.find((entry) => entry.scheme === payment.scheme);
  if (!requirements) {
    // Unknown or expired nonce (or a scheme this challenge never offered):
    // re-challenge rather than settle against requirements we cannot attest to.
    return respondWithChallenge(options, resource, 'unknown or expired challenge; pay again');
  }

  const outcome = await settlePayment(options, payment, requirements);
  const header = encodeHeaderPayload(outcome);

  if (outcome.success) {
    issuedChallenges.delete(payment.payload.nonce);
    return { kind: 'proceed', paymentResponseHeader: header };
  }

  return respondWithChallenge(
    options,
    resource,
    outcome.errorReason ?? 'payment rejected',
    header,
  );
}

/** The response header carrying the encoded settlement outcome. */
export const PAYMENT_RESPONSE_HEADER: X402Header = X402Header.X_PAYMENT_RESPONSE;

/** The request header the client attaches with its payment proof. */
export const PAYMENT_HEADER: X402Header = X402Header.X_PAYMENT;
