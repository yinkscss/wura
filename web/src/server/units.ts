/**
 * Exact decimal amounts as bigint. Money never goes through floating point.
 * No app imports on purpose, so `node --test` can load it.
 */

/** "12.5" with 6 decimals is BigInt(12_500_000). Throws on anything that isn't a plain non-negative decimal or has too many digits. */
export function parseUnits(value: string, decimals: number): bigint {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value)) {
    throw new RangeError("Not a plain decimal amount.");
  }
  const [whole, frac = ""] = value.split(".");
  if (frac.length > decimals) throw new RangeError(`More than ${decimals} decimal places.`);
  return BigInt(whole + frac.padEnd(decimals, "0"));
}

/** BigInt(12_500_000) with 6 decimals is "12.5". */
export function formatUnits(units: bigint, decimals: number): string {
  if (units < BigInt(0)) throw new RangeError("Negative amount.");
  const s = units.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
