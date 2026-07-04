/**
 * Framework-neutral heart of the `x402` middleware. Both the Express and
 * Fastify adapters call {@link decide} and translate its verdict into their own
 * response objects — the x402 protocol logic lives here exactly once.
 *
 *   no X-PAYMENT  → ask the facilitator for a challenge, answer 402
 *   X-PAYMENT     → hand it to the facilitator's /settle; on SETTLED, let the
 *                   route run and attach X-PAYMENT-RESPONSE; else answer 402
 */
import {
  SettleResult,
  X402Header,
  encodeHeaderPayload,
  parsePaymentHeader,
} from '@app/shared';
import type { PaymentPayload, PaymentResponse } from '@app/shared';
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

/** The 402 challenge body issued by the gateway (`accepts[]` requirements). */
interface ChallengeResponse {
  x402Version: number;
  accepts: unknown;
}

function resolveFetch(options: X402MiddlewareOptions): typeof fetch {
  const impl = options.fetchImpl ?? globalThis.fetch;
  if (!impl) throw new Error('no fetch implementation available; pass options.fetchImpl');
  return impl;
}

function base(options: X402MiddlewareOptions): string {
  return options.gatewayUrl.replace(/\/+$/, '');
}

/** Ask the facilitator to issue a single-use challenge for `resource`. */
async function requestChallenge(
  options: X402MiddlewareOptions,
  resource: string,
): Promise<ChallengeResponse> {
  const response = await resolveFetch(options)(`${base(options)}/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sellerId: options.sellerId, resource }),
  });
  if (!response.ok) {
    throw new Error(`facilitator challenge failed (${response.status})`);
  }
  return (await response.json()) as ChallengeResponse;
}

/** Hand a decoded payment to the facilitator's `/settle` and return its verdict. */
async function settlePayment(
  options: X402MiddlewareOptions,
  payment: PaymentPayload,
): Promise<PaymentResponse> {
  const response = await resolveFetch(options)(`${base(options)}/settle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sellerId: options.sellerId, payment }),
  });
  if (!response.ok) {
    throw new Error(`facilitator settle failed (${response.status})`);
  }
  return (await response.json()) as PaymentResponse;
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
    const challenge = await requestChallenge(options, resource);
    return { kind: 'respond', status: 402, body: challenge };
  }

  let payment: PaymentPayload;
  try {
    payment = parsePaymentHeader(paymentHeader);
  } catch {
    return { kind: 'respond', status: 400, body: { error: 'malformed X-PAYMENT header' } };
  }

  const outcome = await settlePayment(options, payment);
  const header = encodeHeaderPayload(outcome);

  if (outcome.result === SettleResult.SETTLED) {
    return { kind: 'proceed', paymentResponseHeader: header };
  }

  return {
    kind: 'respond',
    status: 402,
    paymentResponseHeader: header,
    body: { x402Version: 1, error: outcome.reason ?? 'payment rejected' },
  };
}

/** The response header carrying the encoded settlement outcome. */
export const PAYMENT_RESPONSE_HEADER: X402Header = X402Header.X_PAYMENT_RESPONSE;

/** The request header the client attaches with its payment proof. */
export const PAYMENT_HEADER: X402Header = X402Header.X_PAYMENT;
