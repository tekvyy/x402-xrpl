/**
 * Exact decimal comparison for on-ledger amounts. XRP amounts arrive as integer
 * drop strings and RLUSD amounts as decimals; comparing with `Number` risks
 * float drift, so we scale to a fixed-precision `BigInt` and compare exactly.
 * (The gateway uses the same approach for its amount checks.)
 */

/** Fixed fractional precision used when scaling decimals to integers. */
const SCALE = 15;

function pow10(n: number): bigint {
  let result = 1n;
  for (let i = 0; i < n; i += 1) result *= 10n;
  return result;
}

/** Basic guard: a non-negative decimal (no exponent notation). */
const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** True when `value` is a well-formed non-negative decimal string. */
export function isDecimalString(value: string): boolean {
  return DECIMAL_RE.test(value);
}

/**
 * Scale a non-negative decimal string to a `BigInt` at {@link SCALE} places.
 * @throws Error when `value` is not a valid decimal string.
 */
export function toScaledBigInt(value: string, scale = SCALE): bigint {
  if (!isDecimalString(value)) {
    throw new Error(`Not a valid decimal string: ${value}`);
  }
  const [intPart = '0', fracPart = ''] = value.split('.');
  const frac = fracPart.padEnd(scale, '0').slice(0, scale);
  return BigInt(intPart) * pow10(scale) + BigInt(frac || '0');
}

/** Whether decimal string `a` is greater than or equal to decimal string `b`. */
export function decimalGte(a: string, b: string): boolean {
  return toScaledBigInt(a) >= toScaledBigInt(b);
}
