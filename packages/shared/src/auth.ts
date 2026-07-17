/**
 * Sign-in-with-XRPL (SIWX) wire contract, shared by the gateway (which issues
 * and verifies) and the client helpers (which sign). A user proves control of
 * an XRPL address by signing a short, human-readable challenge message with
 * their wallet key — no passwords, no seed ever leaves the owner.
 *
 * Loosely modelled on EIP-4361 (Sign-In with Ethereum): a deterministic,
 * readable message the wallet displays before signing.
 */
import { z } from 'zod';
import { XRPL_CLASSIC_ADDRESS_PATTERN } from './constants.js';

/** XRPL classic address, validated for shape (also bounds its length). */
export const XrplAddressSchema = z
  .string()
  .regex(XRPL_CLASSIC_ADDRESS_PATTERN, 'not a valid XRPL classic address');

/** Server-issued challenge nonce (32 hex chars today; bounded, not pinned). */
const NonceSchema = z.string().min(1).max(64);

/** Fields that fully determine a sign-in challenge message. */
export interface SignInMessageParams {
  /** XRPL classic address being authenticated. */
  address: string;
  /** Single-use, server-issued nonce. */
  nonce: string;
  /** ISO-8601 timestamp the challenge was issued at. */
  issuedAt: string;
}

/**
 * Build the exact message a wallet signs to authenticate. The gateway stores
 * this verbatim at challenge time and verifies the signature against it, so the
 * format must be byte-stable across client and server — never reformat casually.
 */
export function buildSignInMessage(params: SignInMessageParams): string {
  return [
    'XRPL x402 Gateway wants you to sign in.',
    '',
    `Address: ${params.address}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt}`,
    '',
    'Signing this message proves wallet ownership. It is not a transaction and costs no fees.',
  ].join('\n');
}

/** `POST /auth/challenge` request: who wants to sign in. */
export const AuthChallengeRequestSchema = z.object({
  address: XrplAddressSchema,
});
export type AuthChallengeRequest = z.infer<typeof AuthChallengeRequestSchema>;

/** `POST /auth/challenge` response: the message to sign and when it expires. */
export const AuthChallengeResponseSchema = z.object({
  message: z.string().min(1),
  nonce: z.string().min(1),
  /** Unix epoch (ms) after which the challenge can no longer be redeemed. */
  expiresAt: z.number().int().positive(),
});
export type AuthChallengeResponse = z.infer<typeof AuthChallengeResponseSchema>;

/** `POST /auth/verify` request: the signed challenge message (CLI / keypair path). */
export const AuthVerifyRequestSchema = z.object({
  address: XrplAddressSchema,
  /** The challenge nonce being answered; selects which challenge to verify. */
  nonce: NonceSchema,
  /** Hex signature over the challenge message. */
  signature: z.string().min(1),
  /** Signing public key (hex); must derive to `address`. */
  publicKey: z.string().min(1),
});
export type AuthVerifyRequest = z.infer<typeof AuthVerifyRequestSchema>;

/**
 * `POST /auth/verify-tx` request: a signed (but unsubmitted) transaction whose
 * memo carries the challenge nonce. This is the browser-wallet path — every
 * XRPL wallet can sign a transaction, and a signed tx blob is verifiable
 * server-side deterministically regardless of which wallet produced it (unlike
 * arbitrary-message signing, whose scheme differs per wallet).
 */
export const AuthVerifyTxRequestSchema = z.object({
  address: XrplAddressSchema,
  /** The challenge nonce being answered; selects which challenge to verify. */
  nonce: NonceSchema,
  /** Signed transaction blob (hex) from the wallet's `sign` (not submitted). */
  txBlob: z.string().min(1),
});
export type AuthVerifyTxRequest = z.infer<typeof AuthVerifyTxRequestSchema>;

/**
 * The transaction a wallet signs to prove ownership. A harmless self-targeted
 * `AccountSet` carrying the challenge nonce in a memo; it is never submitted.
 */
export function buildAuthChallengeTx(address: string, nonce: string): Record<string, unknown> {
  return {
    TransactionType: 'AccountSet',
    Account: address,
    Memos: [{ Memo: { MemoData: utf8ToHex(nonce) } }],
  };
}

/** UTF-8 → uppercase hex, without Node's Buffer (browser + node safe). */
export function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex.toUpperCase();
}

/** `POST /auth/verify` response: a bearer session token. */
export const AuthVerifyResponseSchema = z.object({
  token: z.string().min(1),
  address: z.string().min(1),
  /** Unix epoch (ms) at which the session token expires. */
  expiresAt: z.number().int().positive(),
});
export type AuthVerifyResponse = z.infer<typeof AuthVerifyResponseSchema>;

/** HTTP header carrying the bearer session token. */
export const AUTHORIZATION_HEADER = 'authorization';
/** Scheme prefix for the bearer session token. */
export const BEARER_PREFIX = 'Bearer ';
