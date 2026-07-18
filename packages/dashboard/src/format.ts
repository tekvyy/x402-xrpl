/**
 * Presentation helpers shared across dashboard views. Pure, display-only —
 * never mutate or reinterpret the underlying decimal-string amounts.
 */
import { Asset, PaymentMode, PaymentSetup } from '@app/shared';

/** Human label for a payment mode. */
export function paymentModeLabel(mode: PaymentMode): string {
  return mode === PaymentMode.PREPAID_CREDITS ? 'Credits' : 'Pay-per-call';
}

/** Human label for a seller's payment setup (which modes it accepts). */
export function paymentSetupLabel(setup: PaymentSetup): string {
  switch (setup) {
    case PaymentSetup.PAY_PER_CALL:
      return 'Pay-per-call';
    case PaymentSetup.PREPAID_CREDITS:
      return 'Prepaid credits';
    case PaymentSetup.BOTH:
      return 'Pay-per-call + credits';
  }
}

/** Trim a decimal string of trailing zeros while keeping at least one digit. */
export function trimDecimal(value: string): string {
  if (!value.includes('.')) return value;
  const trimmed = value.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '' ? '0' : trimmed;
}

/** Format an amount with its asset suffix, e.g. `1.25 RLUSD`. */
export function formatAmount(amount: string, asset: Asset): string {
  return `${trimDecimal(amount)} ${asset}`;
}

/** Shorten an XRPL classic address to `rXXXX…YYYY` for compact tables. */
export function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Compare non-negative plain decimal strings without losing precision to Number. */
export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const [aWhole = '0', aFraction = ''] = a.split('.');
  const [bWhole = '0', bFraction = ''] = b.split('.');
  const normalizedAWhole = aWhole.replace(/^0+(?=\d)/, '');
  const normalizedBWhole = bWhole.replace(/^0+(?=\d)/, '');
  if (normalizedAWhole.length !== normalizedBWhole.length) {
    return normalizedAWhole.length < normalizedBWhole.length ? -1 : 1;
  }
  if (normalizedAWhole !== normalizedBWhole) return normalizedAWhole < normalizedBWhole ? -1 : 1;

  const width = Math.max(aFraction.length, bFraction.length);
  const normalizedAFraction = aFraction.padEnd(width, '0');
  const normalizedBFraction = bFraction.padEnd(width, '0');
  if (normalizedAFraction === normalizedBFraction) return 0;
  return normalizedAFraction < normalizedBFraction ? -1 : 1;
}

/** Shorten a transaction hash to `ABCD…WXYZ`. */
export function shortenHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

/** Format an ISO timestamp as a local wall-clock time. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
