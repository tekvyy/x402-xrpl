/**
 * RLUSD trustline management. RLUSD is an issued currency, so a wallet must
 * hold a trustline to the issuer before it can receive or send it. `x402fetch`
 * calls this before an RLUSD payment so the first paid request never fails on a
 * missing line (PRD: trustline friction handled by `ensureTrustline`).
 */
import { Client, Wallet } from 'xrpl';
import type { TrustSet } from 'xrpl';
import { RLUSD_CURRENCY_CODE } from '@app/shared';
import { currencyToHex } from './currency.js';
import { ensureConnected } from './wallet.js';

/**
 * Default trustline limit. High enough to be a non-constraint for the demo;
 * a real integration would size this to the wallet's expected exposure.
 */
export const DEFAULT_RLUSD_TRUST_LIMIT = '1000000000';

/** True when `wallet` already trusts `issuer` for RLUSD. */
async function hasTrustline(client: Client, wallet: Wallet, issuer: string): Promise<boolean> {
  const currencyHex = currencyToHex(RLUSD_CURRENCY_CODE);
  const response = await client.request({
    command: 'account_lines',
    account: wallet.classicAddress,
    peer: issuer,
  });
  return response.result.lines.some(
    (line) =>
      line.account === issuer &&
      (line.currency === currencyHex || line.currency === RLUSD_CURRENCY_CODE),
  );
}

/**
 * Ensure `wallet` has an RLUSD trustline to `issuer`. No-op (returns `false`)
 * when the line already exists; otherwise submits a single `TrustSet` and
 * returns `true`. Never creates a duplicate line.
 */
export async function ensureTrustline(
  client: Client,
  wallet: Wallet,
  issuer: string,
  limit: string = DEFAULT_RLUSD_TRUST_LIMIT,
): Promise<boolean> {
  await ensureConnected(client);
  if (await hasTrustline(client, wallet, issuer)) return false;

  const tx: TrustSet = {
    TransactionType: 'TrustSet',
    Account: wallet.classicAddress,
    LimitAmount: { currency: currencyToHex(RLUSD_CURRENCY_CODE), issuer, value: limit },
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  await client.submitAndWait(signed.tx_blob);
  return true;
}
