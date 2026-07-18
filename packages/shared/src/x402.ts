/**
 * x402 wire schemas (zod). These are the shared contract between the client
 * SDK, the gateway facilitator, and the server middleware. Every enum-typed
 * field references `packages/shared` enums — no bare string literals.
 *
 * The shapes follow the x402 v1 specification exactly
 * (coinbase/x402 specs/x402-specification-v1.md):
 *  - `PaymentRequirementsResponse` ≙ the full `402` JSON body.
 *  - `PaymentRequirements`         ≙ one entry in its `accepts[]` array.
 *  - `PaymentPayload`              ≙ the decoded `X-PAYMENT` request header.
 *  - `SettlementResponse`          ≙ the decoded `X-PAYMENT-RESPONSE` header
 *                                    and the facilitator `/settle` response.
 *  - `VerifyResponse`              ≙ the facilitator `/verify` response.
 *  - `FacilitatorRequest`          ≙ the `/verify` and `/settle` request body.
 *
 * Scheme-specific data (the challenge nonce, the RLUSD issuer) rides in the
 * spec's designated extension points: `PaymentRequirements.extra` and the
 * scheme-defined `PaymentPayload.payload` object.
 */
import { z } from 'zod';
import { Asset, X402Scheme } from './enums.js';
import { X402_NETWORKS } from './constants.js';

/** The protocol version this gateway speaks (spec: `x402Version`). */
export const X402_VERSION = 1;

/** x402 v1 standard error codes used by this facilitator (spec §9). */
export const X402ErrorCode = {
  INVALID_PAYLOAD: 'invalid_payload',
  INVALID_PAYMENT_REQUIREMENTS: 'invalid_payment_requirements',
  INVALID_SCHEME: 'invalid_scheme',
  INVALID_NETWORK: 'invalid_network',
  INVALID_X402_VERSION: 'invalid_x402_version',
  UNEXPECTED_VERIFY_ERROR: 'unexpected_verify_error',
  UNEXPECTED_SETTLE_ERROR: 'unexpected_settle_error',
} as const;

const NetworkSchema = z.enum(X402_NETWORKS);

/**
 * Scheme-specific requirement data (`extra`). Both XRPL schemes bind payment
 * to a gateway-issued single-use nonce; RLUSD requirements also carry the
 * issuer address. `passthrough` keeps unknown forward-compat keys intact.
 */
export const PaymentRequirementsExtraSchema = z
  .object({
    /** Single-use nonce binding the payment to this challenge. */
    nonce: z.string().min(1),
    /** RLUSD issuer address; present only for RLUSD requirements. */
    issuer: z.string().min(1).optional(),
  })
  .passthrough();
export type PaymentRequirementsExtra = z.infer<typeof PaymentRequirementsExtraSchema>;

/**
 * One acceptable way to pay, issued inside the 402 challenge. The gateway may
 * offer several (e.g. the `exact` and `paychan` schemes) in `accepts[]`.
 */
export const PaymentRequirementsSchema = z.object({
  /** Payment scheme identifier. */
  scheme: z.nativeEnum(X402Scheme),
  /** XRPL network identifier (`xrpl` / `xrpl-testnet`). */
  network: NetworkSchema,
  /** Required amount as a decimal string (drops for XRP, RLUSD units). */
  maxAmountRequired: z.string().min(1),
  /** Settlement asset. XRPL has no token contracts; the currency code is used. */
  asset: z.nativeEnum(Asset),
  /** XRPL classic address the payment must be sent to. */
  payTo: z.string().min(1),
  /** Resource (path or URL) being purchased. */
  resource: z.string().min(1),
  /** Human-readable description of the resource. */
  description: z.string(),
  /** MIME type of the expected response. */
  mimeType: z.string().optional(),
  /** JSON schema describing the response format. */
  outputSchema: z.record(z.unknown()).optional(),
  /** Seconds the payer has to complete payment before the challenge expires. */
  maxTimeoutSeconds: z.number().int().positive(),
  /** Scheme-specific data: challenge nonce, RLUSD issuer. */
  extra: PaymentRequirementsExtraSchema,
});
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

/** The full 402 response body (spec: `PaymentRequirementsResponse`). */
export const PaymentRequirementsResponseSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  /** Why payment is required (or why the presented payment was rejected). */
  error: z.string(),
  accepts: z.array(PaymentRequirementsSchema),
});
export type PaymentRequirementsResponse = z.infer<typeof PaymentRequirementsResponseSchema>;

/** `exact` scheme payload: a settled XRPL Payment referenced by tx hash. */
export const ExactSchemePayloadSchema = z.object({
  /** Nonce echoed from the challenge (also carried in the tx memo). */
  nonce: z.string().min(1),
  /** Asset the payment settled in. */
  asset: z.nativeEnum(Asset),
  /** Hash of the submitted XRPL Payment transaction. */
  txHash: z.string().min(1),
  /** Payer's XRPL classic address. */
  payer: z.string().min(1),
});
export type ExactSchemePayload = z.infer<typeof ExactSchemePayloadSchema>;

/** `paychan` scheme payload: an off-ledger, monotonic PayChan claim. */
export const PaychanSchemePayloadSchema = z.object({
  nonce: z.string().min(1),
  asset: z.nativeEnum(Asset),
  /** XRPL payment channel id. */
  channelId: z.string().min(1),
  /** Cumulative authorized amount (drops for XRP), as a decimal string. */
  cumulativeAmount: z.string().min(1),
  /** Signature over (channelId, cumulativeAmount) by the payer's key. */
  signature: z.string().min(1),
  /** Payer's XRPL classic address. */
  payer: z.string().min(1),
});
export type PaychanSchemePayload = z.infer<typeof PaychanSchemePayloadSchema>;

/**
 * The decoded `X-PAYMENT` header: the spec envelope
 * `{ x402Version, scheme, network, payload }`, discriminated by `scheme`.
 */
export const PaymentPayloadSchema = z.discriminatedUnion('scheme', [
  z.object({
    x402Version: z.literal(X402_VERSION),
    scheme: z.literal(X402Scheme.EXACT),
    network: NetworkSchema,
    payload: ExactSchemePayloadSchema,
  }),
  z.object({
    x402Version: z.literal(X402_VERSION),
    scheme: z.literal(X402Scheme.PAYCHAN),
    network: NetworkSchema,
    payload: PaychanSchemePayloadSchema,
  }),
]);
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

/**
 * The decoded `X-PAYMENT-RESPONSE` header and the `/settle` response body
 * (spec: `SettlementResponse`). `explorerUrl` is a non-spec convenience field;
 * spec-compliant consumers ignore it.
 */
export const SettlementResponseSchema = z.object({
  success: z.boolean(),
  /** Error reason when settlement failed (omitted on success). */
  errorReason: z.string().optional(),
  /**
   * Settlement tx hash. Empty string when settlement failed and for `paychan`
   * settlements, which are off-ledger (the on-chain redeem happens later).
   */
  transaction: z.string(),
  network: NetworkSchema,
  /** Payer's XRPL classic address (empty string when unknown). */
  payer: z.string(),
  /** Explorer link for `transaction`, when one exists (non-spec extra). */
  explorerUrl: z.string().url().optional(),
});
export type SettlementResponse = z.infer<typeof SettlementResponseSchema>;

/** The facilitator `/verify` response body (spec §7.1). */
export const VerifyResponseSchema = z.object({
  isValid: z.boolean(),
  /** Rejection reason when `isValid` is false (omitted when valid). */
  invalidReason: z.string().optional(),
  /** Payer's XRPL classic address (empty string when unknown). */
  payer: z.string(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

/** The facilitator `/verify` and `/settle` request body (spec §7.1, §7.2). */
export const FacilitatorRequestSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  paymentPayload: PaymentPayloadSchema,
  paymentRequirements: PaymentRequirementsSchema,
});
export type FacilitatorRequest = z.infer<typeof FacilitatorRequestSchema>;

/** One supported (version, scheme, network) triple from `GET /supported`. */
export const SupportedKindSchema = z.object({
  x402Version: z.literal(X402_VERSION),
  scheme: z.nativeEnum(X402Scheme),
  network: NetworkSchema,
});
export type SupportedKind = z.infer<typeof SupportedKindSchema>;

/** The facilitator `GET /supported` response body (spec §7.3). */
export const SupportedResponseSchema = z.object({
  kinds: z.array(SupportedKindSchema),
});
export type SupportedResponse = z.infer<typeof SupportedResponseSchema>;

/**
 * Base64-encode a JSON-serializable value for an x402 header. Uses `btoa` +
 * `TextEncoder` (available in Node 16+ and browsers) so the shared package stays
 * isomorphic — no Node `Buffer`, which would need a browser polyfill.
 */
export function encodeHeaderPayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decode a base64 x402 header back into a parsed JSON value. */
export function decodeHeaderPayload(header: string): unknown {
  const binary = atob(header);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Decode and validate an `X-PAYMENT` header into a typed `PaymentPayload`. */
export function parsePaymentHeader(header: string): PaymentPayload {
  return PaymentPayloadSchema.parse(decodeHeaderPayload(header));
}

/** Decode and validate an `X-PAYMENT-RESPONSE` header. */
export function parseSettlementHeader(header: string): SettlementResponse {
  return SettlementResponseSchema.parse(decodeHeaderPayload(header));
}
