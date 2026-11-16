import assert from "node:assert/strict";
import { test } from "node:test";
import type { PaymentLink } from "@/lib/types";
import { applyPayments, linkStateText, payUri, toStroops, type LinkAsset, type SeenPayment } from "./paylinks";

const USDC: LinkAsset = { code: "USDC", issuer: "GISSUER" };
const T0 = 1_000_000;
const DAY = 86_400_000;

const link = (over: Partial<PaymentLink> = {}): PaymentLink => ({
  id: "lnk_1",
  code: "ABCD2345-10",
  url: "/pay/ABCD2345-10",
  address: "GCREATOR",
  memo: "ABCD2345-10",
  amount: 10_00, // 10.00 USDC
  currency: "USDC",
  status: "open",
  createdAt: T0,
  expiresAt: T0 + 7 * DAY,
  ...over,
});

let n = 0;
const pay = (amount: string, over: Partial<SeenPayment> = {}): SeenPayment => ({
  id: `op${++n}`,
  hash: `hash${n}`,
  amount,
  assetCode: "USDC",
  assetIssuer: "GISSUER",
  memo: "ABCD2345-10",
  at: T0 + DAY,
  ...over,
});

test("toStroops reads Horizon decimals exactly and rejects junk", () => {
  assert.equal(toStroops("10.0000000"), BigInt(100_000_000));
  assert.equal(toStroops("0.0000001"), BigInt(1));
  assert.equal(toStroops("7"), BigInt(70_000_000));
  assert.equal(toStroops("-5"), BigInt(0));
  assert.equal(toStroops("1e9"), BigInt(0));
});

test("no payments: still open", () => {
  const r = applyPayments(link(), USDC, [], T0 + 1);
  assert.equal(r.status, "open");
  assert.equal(r.receivedMinor, 0);
});

test("exact payment with the memo marks it paid, with the tx hash", () => {
  const p = pay("10.0000000");
  const r = applyPayments(link(), USDC, [p], T0 + 2 * DAY);
  assert.equal(r.status, "paid");
  assert.equal(r.paidTx, p.hash);
  assert.equal(r.paidAt, p.at);
  assert.equal(r.payments?.[0].kind, "counted");
});

test("running the same payments again changes nothing", () => {
  const p = pay("10.0000000");
  const once = applyPayments(link(), USDC, [p], T0 + 2 * DAY);
  const twice = applyPayments(once, USDC, [p], T0 + 3 * DAY);
  assert.deepEqual(twice, once);
});

test("more than the amount is paid", () => {
  assert.equal(applyPayments(link(), USDC, [pay("12.5000000")], T0 + 2 * DAY).status, "paid");
});

test("short payment is partial, and a second one that completes it makes it paid", () => {
  const a = pay("4.0000000", { at: T0 + 1 * DAY });
  const part = applyPayments(link(), USDC, [a], T0 + 2 * DAY);
  assert.equal(part.status, "partial");
  assert.equal(part.receivedMinor, 400);
  const b = pay("6.0000000", { at: T0 + 2 * DAY });
  const done = applyPayments(part, USDC, [a, b], T0 + 3 * DAY);
  assert.equal(done.status, "paid");
  assert.equal(done.paidTx, b.hash);
});

test("a second full payment after paid is shown as extra and not counted", () => {
  const a = pay("10.0000000", { at: T0 + 1 * DAY });
  const b = pay("10.0000000", { at: T0 + 2 * DAY });
  const r = applyPayments(link(), USDC, [a, b], T0 + 3 * DAY);
  assert.equal(r.status, "paid");
  assert.equal(r.paidTx, a.hash);
  assert.deepEqual(r.payments?.map((p) => p.kind), ["counted", "extra"]);
  assert.equal(r.receivedMinor, 1000);
  assert.match(linkStateText(r, (m) => `${m / 100}`), /1 other payment/);
});

test("a late payment never marks the link paid", () => {
  const p = pay("10.0000000", { at: T0 + 8 * DAY });
  const r = applyPayments(link(), USDC, [p], T0 + 9 * DAY);
  assert.equal(r.status, "expired");
  assert.equal(r.payments?.[0].kind, "late");
  assert.equal(r.receivedMinor, 0);
});

test("expired with a part payment keeps what arrived in time visible", () => {
  const r = applyPayments(link(), USDC, [pay("3.0000000")], T0 + 9 * DAY);
  assert.equal(r.status, "expired");
  assert.equal(r.receivedMinor, 300);
});

test("same code, wrong issuer is not counted (look-alike token)", () => {
  const fake = pay("10.0000000", { assetIssuer: "GFAKEISSUER" });
  const r = applyPayments(link(), USDC, [fake], T0 + 2 * DAY);
  assert.equal(r.status, "open");
  assert.equal(r.payments?.[0].kind, "wrong_asset");
});

test("other asset (XLM) with the memo is shown, not counted", () => {
  const r = applyPayments(link(), USDC, [pay("500.0000000", { assetCode: "XLM", assetIssuer: "" })], T0 + 2 * DAY);
  assert.equal(r.status, "open");
  assert.equal(r.payments?.[0].kind, "wrong_asset");
});

test("a payment with a different memo or no memo is ignored", () => {
  const r = applyPayments(link(), USDC, [pay("10.0000000", { memo: "OTHER" }), pay("10.0000000", { memo: null })], T0 + 2 * DAY);
  assert.equal(r.status, "open");
  assert.equal(r.payments?.length ?? 0, 0);
});

test("a payment from before the link existed is ignored", () => {
  const r = applyPayments(link(), USDC, [pay("10.0000000", { at: T0 - 1 })], T0 + 2 * DAY);
  assert.equal(r.status, "open");
});

test("a hair under the amount is not enough", () => {
  assert.equal(applyPayments(link(), USDC, [pay("9.9999999")], T0 + 2 * DAY).status, "partial");
});

test("paid is final even if the clock later passes expiry", () => {
  const paid = applyPayments(link(), USDC, [pay("10.0000000")], T0 + 2 * DAY);
  assert.equal(applyPayments(paid, USDC, [], T0 + 30 * DAY).status, "paid");
});

test("SEP-7 pay URI carries destination, amount, asset and memo", () => {
  const u = payUri(link({ amount: 12_50 }), USDC);
  assert.ok(u.startsWith("web+stellar:pay?"));
  const q = new URLSearchParams(u.split("?")[1]);
  assert.equal(q.get("destination"), "GCREATOR");
  assert.equal(q.get("amount"), "12.50");
  assert.equal(q.get("asset_code"), "USDC");
  assert.equal(q.get("asset_issuer"), "GISSUER");
  assert.equal(q.get("memo"), "ABCD2345-10");
  assert.equal(q.get("memo_type"), "MEMO_TEXT");
});
