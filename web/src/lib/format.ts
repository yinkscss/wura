import type { Currency } from "./types";

const ngn0 = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₦50,000 (no kobo unless asked) */
export function naira(minor: number, withKobo = false) {
  const v = minor / 100;
  return "₦" + (withKobo ? two.format(v) : ngn0.format(Math.round(v)));
}

/** 31.20 */
export function usdcNumber(minor: number) {
  return two.format(minor / 100);
}

/** 31.20 USDC */
export function usdc(minor: number) {
  return `${usdcNumber(minor)} USDC`;
}

export function money(minor: number, currency: Currency, withKobo = false) {
  return currency === "NGN" ? naira(minor, withKobo) : usdc(minor);
}

/** 1,602.56 */
export function rate(r: number) {
  return two.format(r);
}

export function shortAddress(a: string) {
  return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 12 Nov, 18:42 */
export function when(ts: number) {
  const d = new Date(ts);
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
}

export function day(ts: number) {
  return dayFmt.format(new Date(ts));
}
