/**
 * XRPL on-ledger currency-code encoding. Codes of three characters or fewer are
 * used verbatim; longer codes (like `RLUSD`) are the 160-bit hex of their ASCII
 * bytes, right-padded with zeros. Mirrors the gateway's encoding so client
 * payments and gateway verification agree on the RLUSD currency.
 */
import { RLUSD_CURRENCY_CODE } from '@app/shared';

/** Encode an ASCII currency code into its XRPL on-ledger representation. */
export function currencyToHex(code: string): string {
  if (code.length <= 3) return code;
  return Buffer.from(code, 'ascii').toString('hex').toUpperCase().padEnd(40, '0');
}

/** The on-ledger currency code used for RLUSD issued amounts. */
export function rlusdCurrency(): string {
  return currencyToHex(RLUSD_CURRENCY_CODE);
}
