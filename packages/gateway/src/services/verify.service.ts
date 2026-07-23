/**
 * The single, shared pay-per-call verification routine. It answers one
 * question — "does this on-ledger Payment satisfy the challenge?" — with no
 * side effects, so it can back the inline proxy path, `/settle`, and the
 * `/verify` facilitator endpoint (US-005) without duplication.
 */
import { Asset, CHANNEL_REDEEM_BUFFER_SEC } from '@app/shared';
import type { ExactSchemePayload, PaychanSchemePayload } from '@app/shared';
import { dropsToXrp, verifyPaymentChannelClaim, xrpToDrops } from 'xrpl';
import { decimalGte, isDecimalString } from '../util/decimal.js';
import type { ChannelRow } from '../db/types.js';
import { XrplService, rippledErrorCode } from './xrpl.service.js';

/** Everything the verifier needs to check a payment against a challenge. */
export interface VerifyContext {
  requiredAsset: Asset;
  /** Required price in the asset's human unit. */
  requiredAmount: string;
  /** Destination the payment must have reached (seller's payTo). */
  payTo: string;
  /** Nonce that must match the payload and appear in a tx memo. */
  nonce: string;
  /** Configured RLUSD issuer, checked for RLUSD payments. */
  rlusdIssuer: string;
}

export interface VerifyOk {
  ok: true;
  txHash: string;
  payer: string;
  /** Delivered amount in the asset's human unit. */
  deliveredHuman: string;
  /** Source tag carried by the payment, when present. */
  sourceTag?: number;
}

export interface VerifyErr {
  ok: false;
  reason: string;
  /**
   * The failure is a gateway-side fault (ledger connection down), not a
   * problem with the payment. Routes map this to a 503 so the payer knows to
   * retry the same X-PAYMENT rather than treat the payment as rejected.
   */
  unavailable?: boolean;
}

export type VerifyResult = VerifyOk | VerifyErr;

const fail = (reason: string): VerifyErr => ({ ok: false, reason });

/** Minimal projection of the fields we read off a `tx` response. */
export interface RawTx {
  validated?: boolean;
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  hash?: string;
  SourceTag?: number;
  Amount?: unknown;
  Memos?: Array<{ Memo?: { MemoData?: string } }>;
  meta?: unknown;
  meta_data?: unknown;
}

/**
 * Flatten a `tx` response envelope. rippled API v2 (the default for xrpl.js
 * ≥ 4) nests the transaction fields under `tx_json` and keeps `validated`,
 * `hash`, and `meta` at the top level; API v1 returns everything flat.
 */
export function unwrapTxResult(result: unknown): RawTx {
  const envelope = result as RawTx & { tx_json?: RawTx };
  if (!envelope.tx_json) return envelope;
  return {
    ...envelope.tx_json,
    validated: envelope.validated,
    hash: envelope.tx_json.hash ?? envelope.hash,
    meta: envelope.meta ?? envelope.tx_json.meta,
  };
}

interface IssuedAmount {
  currency: string;
  issuer: string;
  value: string;
}

function isIssuedAmount(value: unknown): value is IssuedAmount {
  return (
    typeof value === 'object' &&
    value !== null &&
    'currency' in value &&
    'issuer' in value &&
    'value' in value
  );
}

/** Prefer the metadata's actual delivered amount; fall back to the tx Amount. */
function deliveredAmount(tx: RawTx): unknown {
  const meta = (tx.meta ?? tx.meta_data) as
    { delivered_amount?: unknown; DeliveredAmount?: unknown } | string | undefined;
  if (meta && typeof meta === 'object') {
    return meta.delivered_amount ?? meta.DeliveredAmount ?? tx.Amount;
  }
  return tx.Amount;
}

function memoContainsNonce(tx: RawTx, nonce: string): boolean {
  if (!tx.Memos) return false;
  return tx.Memos.some((entry) => {
    const data = entry.Memo?.MemoData;
    if (!data) return false;
    try {
      // Exact match, not substring: a memo embedding two nonces must not satisfy
      // two different challenges off one Payment. Mirrors the auth path's `===`.
      return Buffer.from(data, 'hex').toString('utf8') === nonce;
    } catch {
      return false;
    }
  });
}

/**
 * Delays between `tx` lookup attempts. A payer's `submitAndWait` resolves when
 * *their* rippled server sees the validated ledger; the gateway's own server
 * (often a different member of a load-balanced cluster) can lag by a ledger or
 * two. Absorb that propagation window here rather than rejecting a payment
 * that is already final — a rejected challenge can expire before the payer's
 * retry, stranding real funds.
 */
const TX_VISIBILITY_RETRY_DELAYS_MS = [1500, 2000, 2500];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a transaction, tolerating propagation lag: a genuine `txnNotFound`
 * answer and not-yet-validated responses are retried briefly before giving
 * up. A transport failure (the node never answered: dead socket, timeout) is
 * NOT "not found" — it surfaces as `unavailable` so the payer is told to
 * retry rather than being handed a payment rejection for our own outage.
 * `getTransaction` has already attempted one hard reconnect by then.
 */
async function fetchValidatedTx(xrpl: XrplService, txHash: string): Promise<RawTx | VerifyErr> {
  let seen = false;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await xrpl.getTransaction(txHash);
      const tx = unwrapTxResult(response.result);
      seen = true;
      if (tx.validated === true) return tx;
    } catch (err) {
      if (rippledErrorCode(err) !== 'txnNotFound') {
        return {
          ok: false,
          reason:
            'gateway ledger connection is unavailable; retry the same request ' +
            'with the same X-PAYMENT shortly, do not pay again',
          unavailable: true,
        };
      }
      // A responding node said txnNotFound — possibly propagation lag; retry.
    }
    if (attempt >= TX_VISIBILITY_RETRY_DELAYS_MS.length) {
      return fail(
        seen
          ? 'transaction is not yet validated; retry with the same X-PAYMENT, do not pay again'
          : 'transaction could not be found on the ledger; if it is validated, retry with the same X-PAYMENT, do not pay again',
      );
    }
    await sleep(TX_VISIBILITY_RETRY_DELAYS_MS[attempt] ?? 0);
  }
}

/**
 * Verify a pay-per-call payment. Reads the referenced transaction from the
 * ledger and checks asset, destination, amount, nonce memo, and validation.
 */
export async function verifyPayPerCall(
  xrpl: XrplService,
  payload: ExactSchemePayload,
  ctx: VerifyContext,
): Promise<VerifyResult> {
  if (payload.asset !== ctx.requiredAsset) return fail('asset does not match the challenge');
  if (payload.nonce !== ctx.nonce) return fail('nonce does not match the challenge');

  const tx = await fetchValidatedTx(xrpl, payload.txHash);
  if ('ok' in tx) return tx;
  if (tx.TransactionType !== 'Payment') return fail('referenced transaction is not a Payment');
  if (tx.Destination !== ctx.payTo) return fail('payment destination does not match seller');
  if (!tx.Account) return fail('transaction has no sender');
  if (payload.payer !== tx.Account)
    return fail('claimed payer does not match the on-ledger sender');
  if (!memoContainsNonce(tx, ctx.nonce)) return fail('challenge nonce missing from tx memo');

  const delivered = deliveredAmount(tx);
  const amountCheck = checkAmount(ctx, delivered);
  if (!amountCheck.ok) return amountCheck;

  return {
    ok: true,
    txHash: tx.hash ?? payload.txHash,
    payer: tx.Account,
    deliveredHuman: amountCheck.human,
    sourceTag: tx.SourceTag,
  };
}

type AmountCheck = { ok: true; human: string } | VerifyErr;

function checkAmount(ctx: VerifyContext, delivered: unknown): AmountCheck {
  if (ctx.requiredAsset === Asset.XRP) {
    if (typeof delivered !== 'string' || !isDecimalString(delivered)) {
      return fail('expected an XRP (drops) amount');
    }
    const requiredDrops = xrpToDrops(ctx.requiredAmount);
    if (!decimalGte(delivered, requiredDrops)) return fail('paid amount is below the price');
    return { ok: true, human: dropsToXrpString(delivered) };
  }

  if (!isIssuedAmount(delivered)) return fail('expected an RLUSD issued-currency amount');
  if (delivered.currency !== XrplService.rlusdCurrency()) return fail('paid currency is not RLUSD');
  if (delivered.issuer !== ctx.rlusdIssuer) return fail('RLUSD issuer does not match');
  if (!isDecimalString(delivered.value) || !decimalGte(delivered.value, ctx.requiredAmount)) {
    return fail('paid amount is below the price');
  }
  return { ok: true, human: delivered.value };
}

/** A verified prepaid claim, ready to be applied to the channel ledger. */
export interface PrepaidVerifyOk {
  ok: true;
  /** New cumulative authorized amount in the asset's human unit. */
  newCumulativeHuman: string;
  /** Price charged for this call in the human unit (the challenge amount). */
  chargeHuman: string;
  /** Validated claim signature. */
  signature: string;
}

export type PrepaidVerifyResult = PrepaidVerifyOk | VerifyErr;

/**
 * Verify a prepaid-credits PayChan claim against its channel — side-effect
 * free, so it backs both `/settle` and (later) `/verify`. Checks the channel is
 * usable, the signature is valid for the cumulative amount, the amount is
 * strictly monotonic and within the deposit, and the increment covers the
 * call's price. XRPL PayChan is XRP-native, so only XRP claims are accepted.
 */
export function verifyPrepaidClaim(
  payload: PaychanSchemePayload,
  channel: ChannelRow,
  ctx: VerifyContext,
  nowMs: number = Date.now(),
): PrepaidVerifyResult {
  if (ctx.requiredAsset !== Asset.XRP) {
    return fail('PayChan credits support XRP only; use pay-per-call or escrow for RLUSD');
  }
  if (payload.asset !== ctx.requiredAsset) return fail('asset does not match the challenge');
  if (channel.asset !== Asset.XRP) return fail('channel asset is not XRP');
  if (channel.wallet_address !== payload.payer) return fail('claim payer does not own the channel');
  if (!channel.public_key) return fail('channel is missing its signing public key');

  // Stop honoring off-ledger claims once the channel is within the redeem buffer
  // of its immutable CancelAfter — past that the gateway may not be able to
  // redeem before the payer can cancel and reclaim the deposit. Delivering more
  // value here would be unbacked, so reject and force a fresh channel.
  if (
    channel.cancel_after != null &&
    channel.cancel_after.getTime() - nowMs <= CHANNEL_REDEEM_BUFFER_SEC * 1000
  ) {
    return fail('channel is at or near its expiry; open a new channel');
  }

  if (!isDecimalString(payload.cumulativeAmount)) return fail('cumulative amount is not numeric');
  const newCumulativeHuman = String(dropsToXrp(payload.cumulativeAmount));

  const signatureValid = verifyPaymentChannelClaim(
    payload.channelId,
    newCumulativeHuman,
    payload.signature,
    channel.public_key,
  );
  if (!signatureValid) return fail('claim signature is invalid');

  if (!decimalGte(channel.credits_total, newCumulativeHuman)) {
    return fail('claim exceeds the channel deposit');
  }
  if (decimalGte(channel.credits_used, newCumulativeHuman)) {
    return fail('claim is stale or duplicate (not strictly increasing)');
  }
  const increment = subtractHuman(newCumulativeHuman, channel.credits_used);
  if (!decimalGte(increment, ctx.requiredAmount)) {
    return fail('claim increment does not cover the call price');
  }

  return {
    ok: true,
    newCumulativeHuman,
    chargeHuman: ctx.requiredAmount,
    signature: payload.signature,
  };
}

/** Subtract two non-negative XRP decimal strings (a >= b) at drop precision. */
function subtractHuman(a: string, b: string): string {
  const diffDrops = BigInt(xrpToDrops(a)) - BigInt(xrpToDrops(b));
  return dropsToXrpString(diffDrops.toString());
}

/** Convert an integer drops string to a plain XRP decimal string. */
function dropsToXrpString(drops: string): string {
  const asBig = BigInt(drops);
  const whole = asBig / 1_000_000n;
  const frac = (asBig % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
