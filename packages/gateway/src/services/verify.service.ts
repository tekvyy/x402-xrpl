/**
 * The single, shared pay-per-call verification routine. It answers one
 * question — "does this on-ledger Payment satisfy the challenge?" — with no
 * side effects, so it can back the inline proxy path, `/settle`, and the
 * `/verify` facilitator endpoint (US-005) without duplication.
 */
import { Asset } from '@app/shared';
import type { PayPerCallPayload } from '@app/shared';
import { xrpToDrops } from 'xrpl';
import { decimalGte, isDecimalString } from '../util/decimal.js';
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

/** Convert an integer drops string to a plain XRP decimal string. */
function dropsToXrpString(drops: string): string {
  const asBig = BigInt(drops);
  const whole = asBig / 1_000_000n;
  const frac = (asBig % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
