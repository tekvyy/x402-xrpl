/**
 * The single, shared pay-per-call verification routine. It answers one
 * question — "does this on-ledger Payment satisfy the challenge?" — with no
 * side effects, so it can back the inline proxy path, `/settle`, and the
 * `/verify` facilitator endpoint (US-005) without duplication.
 */
import { Asset } from '@app/shared';
import type { PayPerCallPayload, PrepaidCreditsPayload } from '@app/shared';
import { dropsToXrp, verifyPaymentChannelClaim, xrpToDrops } from 'xrpl';
import { decimalGte, isDecimalString } from '../util/decimal.js';
import type { ChannelRow } from '../db/types.js';
import { XrplService } from './xrpl.service.js';

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
}

export type VerifyResult = VerifyOk | VerifyErr;

const fail = (reason: string): VerifyErr => ({ ok: false, reason });

/** Minimal projection of the fields we read off a `tx` response. */
interface RawTx {
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
    | { delivered_amount?: unknown; DeliveredAmount?: unknown }
    | string
    | undefined;
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
      return Buffer.from(data, 'hex').toString('utf8').includes(nonce);
    } catch {
      return false;
    }
  });
}

/**
 * Verify a pay-per-call payment. Reads the referenced transaction from the
 * ledger and checks asset, destination, amount, nonce memo, and validation.
 */
export async function verifyPayPerCall(
  xrpl: XrplService,
  payload: PayPerCallPayload,
  ctx: VerifyContext,
): Promise<VerifyResult> {
  if (payload.asset !== ctx.requiredAsset) return fail('asset does not match the challenge');
  if (payload.nonce !== ctx.nonce) return fail('nonce does not match the challenge');

  let response;
  try {
    response = await xrpl.getTransaction(payload.txHash);
  } catch {
    return fail('transaction could not be found on the ledger');
  }

  const tx = response.result as unknown as RawTx;
  if (tx.validated !== true) return fail('transaction is not yet validated');
  if (tx.TransactionType !== 'Payment') return fail('referenced transaction is not a Payment');
  if (tx.Destination !== ctx.payTo) return fail('payment destination does not match seller');
  if (!tx.Account) return fail('transaction has no sender');
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
  payload: PrepaidCreditsPayload,
  channel: ChannelRow,
  ctx: VerifyContext,
): PrepaidVerifyResult {
  if (ctx.requiredAsset !== Asset.XRP) {
    return fail('PayChan credits support XRP only; use pay-per-call or escrow for RLUSD');
  }
  if (payload.asset !== ctx.requiredAsset) return fail('asset does not match the challenge');
  if (channel.asset !== Asset.XRP) return fail('channel asset is not XRP');
  if (channel.wallet_address !== payload.payer) return fail('claim payer does not own the channel');
  if (!channel.public_key) return fail('channel is missing its signing public key');

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
