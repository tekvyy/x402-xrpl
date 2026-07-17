/**
 * Exact decimal comparison for on-ledger amounts. XRP amounts arrive as
 * integer drop strings and RLUSD amounts as decimals; comparing with `Number`
 * risks float drift, so we compare the digits exactly with `BigInt` at
 * whatever precision the inputs carry — no fixed scale, so no digit is ever
 * silently dropped. Exponent notation is rejected by design. (The gateway
 * uses the same approach for its amount checks.)
 */

/** Basic guard: a non-negative plain decimal (no sign, no exponent). */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** True when `value` is a well-formed non-negative decimal string. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/**
 * Compare two non-negative decimal strings exactly: -1, 0, or 1.
 * @throws Error when either value is not a valid decimal string.
 */
export function compareDecimals(a: string, b: string): -1 | 0 | 1 {
  if (!isDecimalString(a)) throw new Error(`Not a valid decimal string: ${a}`);
  if (!isDecimalString(b)) throw new Error(`Not a valid decimal string: ${b}`);
  const [aInt = '0', aFrac = ''] = a.split('.');
  const [bInt = '0', bFrac = ''] = b.split('.');
  const width = Math.max(aFrac.length, bFrac.length);
  const scaledA = BigInt(aInt + aFrac.padEnd(width, '0'));
  const scaledB = BigInt(bInt + bFrac.padEnd(width, '0'));
  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

/** Whether decimal string `a` is greater than or equal to decimal string `b`. */
export function decimalGte(a: string, b: string): boolean {
  return compareDecimals(a, b) >= 0;
}
