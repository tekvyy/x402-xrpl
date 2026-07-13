/**
 * Custodial escrow-credits fallback (config-gated; demo insurance only). A
 * wallet deposits an asset once to the gateway wallet, and credits are then
 * spent off-ledger. This path is deliberately isolated from PayChan: it has its
 * own table and never touches channel settlement. Enable via `ESCROW_ENABLED`.
 */
import { Asset } from '@app/shared';
import {
  createEscrowCredit,
  debitEscrowCredit,
  getEscrowCreditByTxHash,
  getSeller,
  insertUsageEvent,
} from '../db/repositories.js';
import type { EscrowCreditRow, UsageEventRow } from '../db/types.js';
import { PaymentMode } from '@app/shared';
import { publishUsageEvent } from './usage.service.js';
import { unwrapTxResult } from './verify.service.js';
import { XrplService } from './xrpl.service.js';
import { decimalGte, isDecimalString } from '../util/decimal.js';
import type { GatewayDeps } from '../deps.js';

export interface EscrowDepositInput {
  sellerId: string;
  walletAddress: string;
  /** Hash of the on-ledger Payment that funded the gateway wallet. */
  txHash: string;
}

export type EscrowDepositResult =
  | { ok: true; credit: EscrowCreditRow }
  | { ok: false; reason: string };

/** Minimal projection of the deposit Payment we read off the ledger. */
interface RawTx {
  validated?: boolean;
  TransactionType?: string;
  Account?: string;
  Destination?: string;
  Amount?: unknown;
  meta?: { delivered_amount?: unknown; DeliveredAmount?: unknown } | string;
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

function deliveredAmount(tx: RawTx): unknown {
  const meta = tx.meta;
  if (meta && typeof meta === 'object') {
    return meta.delivered_amount ?? meta.DeliveredAmount ?? tx.Amount;
  }
  return tx.Amount;
}

/**
 * Verify an on-ledger deposit Payment to the gateway wallet and credit the
 * wallet's escrow balance. Idempotent on the deposit tx hash.
 */
export async function depositEscrow(
  deps: GatewayDeps,
  input: EscrowDepositInput,
): Promise<EscrowDepositResult> {
  const existing = await getEscrowCreditByTxHash(deps.pool, input.txHash);
  if (existing) return { ok: true, credit: existing };

  const seller = await getSeller(deps.pool, input.sellerId);
  if (!seller) return { ok: false, reason: 'seller not found' };

  let response;
  try {
    response = await deps.xrpl.getTransaction(input.txHash);
  } catch {
    return { ok: false, reason: 'deposit transaction not found on the ledger' };
  }

  const tx = unwrapTxResult(response.result) as RawTx;
  if (tx.validated !== true) return { ok: false, reason: 'deposit is not yet validated' };
  if (tx.TransactionType !== 'Payment') return { ok: false, reason: 'deposit is not a Payment' };
  if (tx.Destination !== deps.xrpl.address()) {
    return { ok: false, reason: 'deposit was not sent to the gateway wallet' };
  }
  if (tx.Account !== input.walletAddress) {
    return { ok: false, reason: 'deposit sender does not match the wallet' };
  }

  const amount = readAmount(deliveredAmount(tx), seller.price_asset, deps.env.rlusdIssuer);
  if (!amount.ok) return { ok: false, reason: amount.reason };
  if (!decimalGte(amount.human, seller.price_amount)) {
    return { ok: false, reason: 'deposit is below one call price' };
  }

  const credit = await createEscrowCredit(deps.pool, {
    sellerId: seller.id,
    walletAddress: input.walletAddress,
    asset: seller.price_asset,
    depositTxHash: input.txHash,
    creditsTotal: amount.human,
  });
  return { ok: true, credit };
}

export type EscrowDebitResult = { ok: true } | { ok: false; reason: string };

/**
 * Debit `amount` (human unit) of a wallet's escrow credits for a metered call
 * and record it as a usage event. Off-ledger and atomic; rejects when the
 * balance is insufficient.
 */
export async function debitEscrow(
  deps: GatewayDeps,
  sellerId: string,
  walletAddress: string,
  endpoint: string,
  asset: Asset,
  amount: string,
): Promise<EscrowDebitResult> {
  const client = await deps.pool.connect();
  let usageEvent: UsageEventRow;
  try {
    await client.query('BEGIN');
    const debited = await debitEscrowCredit(client, sellerId, walletAddress, amount);
    if (!debited) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'insufficient escrow credits' };
    }
    usageEvent = await insertUsageEvent(client, {
      sellerId,
      walletAddress,
      endpoint,
      amount,
      asset,
      mode: PaymentMode.PREPAID_CREDITS,
      txHash: null,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await publishUsageEvent(deps.redis, usageEvent);
  return { ok: true };
}

type AmountResult = { ok: true; human: string } | { ok: false; reason: string };

function readAmount(delivered: unknown, asset: Asset, rlusdIssuer: string): AmountResult {
  if (asset === Asset.XRP) {
    if (typeof delivered !== 'string' || !isDecimalString(delivered)) {
      return { ok: false, reason: 'expected an XRP (drops) amount' };
    }
    return { ok: true, human: dropsToXrpString(delivered) };
  }
  if (!isIssuedAmount(delivered)) return { ok: false, reason: 'expected an RLUSD amount' };
  if (delivered.currency !== XrplService.rlusdCurrency()) {
    return { ok: false, reason: 'deposit currency is not RLUSD' };
  }
  if (delivered.issuer !== rlusdIssuer) return { ok: false, reason: 'RLUSD issuer does not match' };
  if (!isDecimalString(delivered.value)) return { ok: false, reason: 'RLUSD amount is not numeric' };
  return { ok: true, human: delivered.value };
}

function dropsToXrpString(drops: string): string {
  const asBig = BigInt(drops);
  const whole = asBig / 1_000_000n;
  const frac = (asBig % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}
