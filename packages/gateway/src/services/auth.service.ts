/**
 * Sign-in-with-XRPL (SIWX) service. Issues a single-use challenge, verifies the
 * wallet signature over it, and mints/validates a stateless HMAC session token.
 *
 *   POST /auth/challenge  → store message in redis, return it to sign
 *   POST /auth/verify     → check signature + derive address, issue token
 *   requireAuth           → validate the bearer token on protected routes
 *
 * No account table is needed: the XRPL address *is* the identity, and sessions
 * are self-verifying tokens (payload + HMAC), so the gateway holds no auth state
 * beyond the short-lived challenge nonce in redis.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import { decode, deriveAddress, verifyKeypairSignature, verifySignature } from 'xrpl';
import { CHALLENGE_TTL_MS, buildSignInMessage } from '@app/shared';
import type { AuthChallengeResponse, AuthVerifyResponse } from '@app/shared';
import { SESSION_TTL_MS } from '../constants.js';

// Keyed by (address, nonce), not address alone: an unauthenticated
// /auth/challenge for someone else's address must never overwrite that
// victim's in-flight challenge (login denial of service).
function challengeKey(address: string, nonce: string): string {
  return `auth:challenge:${address}:${nonce}`;
}

/** What we persist per challenge — enough to verify either signing path. */
interface StoredChallenge {
  nonce: string;
  message: string;
}

/**
 * Fetch and consume (single-use) the stored challenge for an (address, nonce)
 * pair. Uses `GETDEL` so the read-and-delete is atomic — two concurrent
 * verifies can never both claim the same challenge.
 */
async function takeChallenge(
  redis: Redis,
  address: string,
  nonce: string,
): Promise<StoredChallenge | null> {
  const raw = await redis.getdel(challengeKey(address, nonce));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredChallenge;
  } catch {
    return null;
  }
}

/**
 * Issue a sign-in challenge for `address`: generate a nonce, build the message,
 * cache it (single-use, TTL-bounded) in redis, and return it for signing.
 */
export async function issueAuthChallenge(
  redis: Redis,
  address: string,
  now: number = Date.now(),
): Promise<AuthChallengeResponse> {
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date(now).toISOString();
  const message = buildSignInMessage({ address, nonce, issuedAt });
  const stored: StoredChallenge = { nonce, message };
  await redis.set(challengeKey(address, nonce), JSON.stringify(stored), 'PX', CHALLENGE_TTL_MS);
  return { message, nonce, expiresAt: now + CHALLENGE_TTL_MS };
}

export interface VerifyAuthInput {
  address: string;
  /** The challenge nonce this verification answers. */
  nonce: string;
  signature: string;
  publicKey: string;
}

export type AuthVerifyOutcome =
  | { ok: true; response: AuthVerifyResponse }
  | { ok: false; reason: string };

/**
 * Verify a signed challenge and, on success, mint a session token. The challenge
 * is consumed (deleted) whether or not the signature checks out, so a nonce can
 * never be replayed.
 */
export async function verifyAuthSignature(
  redis: Redis,
  authSecret: string,
  input: VerifyAuthInput,
  now: number = Date.now(),
): Promise<AuthVerifyOutcome> {
  const challenge = await takeChallenge(redis, input.address, input.nonce);
  if (!challenge) return { ok: false, reason: 'no active challenge; request a new one' };

  let derived: string;
  try {
    derived = deriveAddress(input.publicKey);
  } catch {
    return { ok: false, reason: 'invalid public key' };
  }
  if (derived !== input.address) {
    return { ok: false, reason: 'public key does not match the address' };
  }

  const messageHex = Buffer.from(challenge.message, 'utf8').toString('hex');
  let valid = false;
  try {
    valid = verifyKeypairSignature(messageHex, input.signature, input.publicKey);
  } catch {
    return { ok: false, reason: 'malformed signature' };
  }
  if (!valid) return { ok: false, reason: 'signature does not match the challenge' };

  return issueSession(authSecret, input.address, now);
}

export interface VerifyAuthTxInput {
  address: string;
  /** The challenge nonce this verification answers. */
  nonce: string;
  txBlob: string;
}

/** Minimal projection of a decoded transaction we read for auth. */
interface DecodedAuthTx {
  Account?: unknown;
  SigningPubKey?: unknown;
  Memos?: Array<{ Memo?: { MemoData?: unknown } }>;
}

/** Whether any memo's data decodes exactly to `nonce`. */
function memosContainNonce(memos: DecodedAuthTx['Memos'], nonce: string): boolean {
  if (!Array.isArray(memos)) return false;
  return memos.some((entry) => {
    const data = entry.Memo?.MemoData;
    if (typeof data !== 'string') return false;
    try {
      return Buffer.from(data, 'hex').toString('utf8') === nonce;
    } catch {
      return false;
    }
  });
}

/**
 * Verify a wallet-signed challenge transaction and, on success, mint a session
 * token. The tx is decoded (never submitted) and checked four ways: it is from
 * the claimed account, its signing key derives to that account, its signature is
 * valid, and it carries the issued nonce in a memo. Works for any XRPL wallet
 * that can sign a transaction.
 */
export async function verifyAuthTransaction(
  redis: Redis,
  authSecret: string,
  input: VerifyAuthTxInput,
  now: number = Date.now(),
): Promise<AuthVerifyOutcome> {
  const challenge = await takeChallenge(redis, input.address, input.nonce);
  if (!challenge) return { ok: false, reason: 'no active challenge; request a new one' };

  let tx: DecodedAuthTx;
  try {
    tx = decode(input.txBlob) as unknown as DecodedAuthTx;
  } catch {
    return { ok: false, reason: 'could not decode the signed transaction' };
  }

  if (tx.Account !== input.address) {
    return { ok: false, reason: 'transaction account does not match the address' };
  }
  if (typeof tx.SigningPubKey !== 'string' || tx.SigningPubKey.length === 0) {
    return { ok: false, reason: 'transaction is not single-signed' };
  }
  let derived: string;
  try {
    derived = deriveAddress(tx.SigningPubKey);
  } catch {
    return { ok: false, reason: 'invalid signing public key' };
  }
  if (derived !== input.address) {
    return { ok: false, reason: 'signing key does not match the address' };
  }
  if (!memosContainNonce(tx.Memos, challenge.nonce)) {
    return { ok: false, reason: 'challenge nonce missing from the transaction memo' };
  }

  let valid = false;
  try {
    valid = verifySignature(input.txBlob);
  } catch {
    return { ok: false, reason: 'malformed transaction signature' };
  }
  if (!valid) return { ok: false, reason: 'transaction signature is invalid' };

  return issueSession(authSecret, input.address, now);
}

/** Mint a session outcome for a proven address. */
function issueSession(authSecret: string, address: string, now: number): AuthVerifyOutcome {
  const expiresAt = now + SESSION_TTL_MS;
  const token = signToken(authSecret, address, expiresAt);
  return { ok: true, response: { token, address, expiresAt } };
}

/** Verify a bearer token and return the authenticated address, or null. */
export function verifyToken(
  authSecret: string,
  token: string,
  now: number = Date.now(),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signatureB64] = parts as [string, string];

  const expected = hmac(authSecret, payloadB64);
  const provided = fromBase64Url(signatureB64);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  let payload: { sub?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') return null;
  if (payload.exp <= now) return null;
  return payload.sub;
}

/** Mint a `<payload>.<hmac>` token binding an address to an expiry. */
function signToken(authSecret: string, address: string, expiresAt: number): string {
  const payload = toBase64Url(Buffer.from(JSON.stringify({ sub: address, exp: expiresAt }), 'utf8'));
  const signature = toBase64Url(hmac(authSecret, payload));
  return `${payload}.${signature}`;
}

function hmac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Buffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}
