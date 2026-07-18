/**
 * Pay-per-call payment builder. Given the x402 `PaymentRequirements` from a 402
 * challenge, submit a source-tagged XRPL Payment that satisfies the amount,
 * asset, and destination, carrying the challenge nonce in a memo so the gateway
 * can bind the payment to the request. Returns the settled tx hash.
 */
import { Client, Wallet } from 'xrpl';
import type { Amount, Payment } from 'xrpl';
import { Asset, RLUSD_CURRENCY_CODE } from '@app/shared';
import type { PaymentRequirements } from '@app/shared';
import { currencyToHex } from './currency.js';
import { ensureConnected } from './wallet.js';

export interface PayChallengeParams {
  client: Client;
  wallet: Wallet;
  requirements: PaymentRequirements;
  /** Team source tag stamped on the Payment (leaderboard attribution). */
  sourceTag: number;
}

/**
 * Build the on-ledger `Amount` for a challenge. The wire `maxAmountRequired`
 * already uses the x402 atomic-unit convention (drops for XRP, decimal units
 * for RLUSD), so it maps directly onto the XRPL representation with no further
 * conversion.
 */
function buildAmount(requirements: PaymentRequirements): Amount {
  if (requirements.asset === Asset.XRP) return requirements.maxAmountRequired;
  if (!requirements.extra.issuer) {
    throw new Error('RLUSD requirement is missing the issuer address');
  }
  return {
    currency: currencyToHex(RLUSD_CURRENCY_CODE),
    issuer: requirements.extra.issuer,
    value: requirements.maxAmountRequired,
  };
}

/** Encode a UTF-8 string as an uppercase hex memo payload. */
function toMemoData(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase();
}

/**
 * Submit a source-tagged Payment matching `requirements` and wait for
 * validation. The challenge nonce travels in a memo so the gateway's verifier
 * can match the on-ledger payment to the pending challenge.
 */
export async function payChallenge(params: PayChallengeParams): Promise<string> {
  const { client, wallet, requirements, sourceTag } = params;
  await ensureConnected(client);

  const tx: Payment = {
    TransactionType: 'Payment',
    Account: wallet.classicAddress,
    Destination: requirements.payTo,
    Amount: buildAmount(requirements),
    SourceTag: sourceTag,
    Memos: [{ Memo: { MemoData: toMemoData(requirements.extra.nonce) } }],
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  return result.result.hash;
}
