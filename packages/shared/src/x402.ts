/**
 * x402 wire schemas (zod). These are the shared contract between the client
 * SDK, the gateway facilitator, and the server middleware. Every enum-typed
 * field references `packages/shared` enums — no bare string literals.
 *
 * Maps to Coinbase x402 on Base:
 *  - `PaymentRequirements` ≙ an entry in the `402` `accepts[]` array.
 *  - `PaymentPayload`      ≙ the decoded `X-PAYMENT` request header.
 *  - `PaymentResponse`     ≙ the decoded `X-PAYMENT-RESPONSE` header.
 */
import { z } from 'zod';
import { Asset, PaymentMode, SettleResult } from './enums.js';

/**
 * One acceptable way to pay, issued inside the 402 challenge. The gateway may
 * offer several (e.g. RLUSD and XRP) in the `accepts[]` array.
 */
export const PaymentRequirementsSchema = z.object({
  /** Which payment mechanism this requirement describes. */
  mode: z.nativeEnum(PaymentMode),
  /** Settlement asset. */
  asset: z.nativeEnum(Asset),
  /** Required amount as a decimal string (drops for XRP, RLUSD units). */
  amount: z.string().min(1),
  /** XRPL classic address the payment must be sent to. */
  payTo: z.string().min(1),
  /** Single-use nonce binding the payment to this request. */
  nonce: z.string().min(1),
  /** Resource (path) being purchased. */
  resource: z.string().min(1),
  /** Unix epoch (ms) after which the challenge is no longer payable. */
  expiresAt: z.number().int().positive(),
  /** RLUSD issuer address; present only for RLUSD requirements. */
  issuer: z.string().min(1).optional(),
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/** Pay-per-call proof: a settled XRPL Payment referenced by tx hash. */
export const PayPerCallPayloadSchema = z.object({
  mode: z.literal(PaymentMode.PAY_PER_CALL),
  asset: z.nativeEnum(Asset),
  /** Nonce echoed from the challenge (also carried in the tx memo). */
  nonce: z.string().min(1),
  /** Hash of the submitted XRPL Payment transaction. */
  txHash: z.string().min(1),
  /** Payer's XRPL classic address. */
  payer: z.string().min(1),
});
export type PayPerCallPayload = z.infer<typeof PayPerCallPayloadSchema>;

/** Prepaid-credits proof: an off-ledger, monotonic PayChan claim. */
export const PrepaidCreditsPayloadSchema = z.object({
  mode: z.literal(PaymentMode.PREPAID_CREDITS),
  asset: z.nativeEnum(Asset),
  nonce: z.string().min(1),
  /** XRPL payment channel id. */
  channelId: z.string().min(1),
  /** Cumulative authorized amount (drops for XRP), as a decimal string. */
  cumulativeAmount: z.string().min(1),
  /** Signature over (channelId, cumulativeAmount) by the payer's key. */
  signature: z.string().min(1),
  /** Payer's XRPL classic address. */
  payer: z.string().min(1),
});
export type PrepaidCreditsPayload = z.infer<typeof PrepaidCreditsPayloadSchema>;

/** The decoded `X-PAYMENT` header, discriminated by `PaymentMode`. */
export const PaymentPayloadSchema = z.discriminatedUnion('mode', [
  PayPerCallPayloadSchema,
  PrepaidCreditsPayloadSchema,
]);
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

/** The decoded `X-PAYMENT-RESPONSE` header returned on settlement. */
export const PaymentResponseSchema = z.object({
  result: z.nativeEnum(SettleResult),
  /** Settlement tx hash, when one exists (absent for pure verify). */
  txHash: z.string().min(1).optional(),
  /** Explorer URL for `txHash`, when present. */
  explorerUrl: z.string().url().optional(),
  /** Human-readable reason, primarily for `REJECTED`. */
  reason: z.string().optional(),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;

/** Base64-encode a JSON-serializable value for an x402 header. */
export function encodeHeaderPayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

/** Decode a base64 x402 header back into a parsed JSON value. */
export function decodeHeaderPayload(header: string): unknown {
  return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
}

/** Decode and validate an `X-PAYMENT` header into a typed `PaymentPayload`. */
export function parsePaymentHeader(header: string): PaymentPayload {
  return PaymentPayloadSchema.parse(decodeHeaderPayload(header));
}
