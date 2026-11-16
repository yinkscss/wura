import assert from "node:assert/strict";
import { test } from "node:test";

process.env.MONEY_MODE = "mainnet";
process.env.APP_URL = "https://wura.example";
process.env.NEXT_PUBLIC_PRIVY_APP_ID = "app-id";
process.env.PRIVY_APP_SECRET = "privy-secret";
process.env.DATABASE_URL = "postgres://nobody@localhost:1/none"; // never connected: these tests don't touch the database
process.env.SESSION_SECRET = "y".repeat(40);
process.env.STELLAR_HORIZON_URL = "http://127.0.0.1:9"; // nothing listens: a Horizon read fails fast instead of reaching the network
process.env.BETA_ALLOWLIST = "a@example.com";
for (const k of ["VERCEL_ENV", "TESTNET_SIGNER", "AGENT_KEY_SECRET", "STELLAR_USDC_ISSUER", "TESTNET_CONTACTS", "MONEY_KILL", "TREASURY_SECRET", "QUOTE_SOURCE", "QUOTE_NGN_ASSET"]) delete process.env[k];

import type { Transaction } from "@stellar/stellar-sdk";
import type { Quote } from "@/lib/types";
const { Account, Asset, Keypair, TransactionBuilder, Networks } = await import("@stellar/stellar-sdk");
const { assetFor, buildTx, swapOp } = await import("./stellar");
const { finishSwap, recheckSwap } = await import("./swaps");
import type { WalletState } from "./store";
// Only the fields the swap rules touch; the store itself needs withWallet() and a database.
const wallet = () => ({ spentToday: { NGN: 0, USDC: 0 }, activity: [] }) as unknown as WalletState;
const { ApiFailure } = await import("./errors");

const me = Keypair.random().publicKey();
const s = { userId: "u-swap", email: "a@example.com", address: me };

test("a swap is a strict-send path payment to your own wallet, with the minimum and route encoded", () => {
  const xlm = Asset.native();
  const op = swapOp({ address: me, sendAsset: assetFor("NGN")!, sendCents: 10_000_00, destAsset: assetFor("USDC")!, destMinCents: 6_20, path: [xlm] });
  const built = buildTx(new Account(me, "7"), op);
  const tx = TransactionBuilder.fromXDR(built.xdr, Networks.PUBLIC) as Transaction;
  const o = tx.operations[0] as unknown as { type: string; destination: string; sendAmount: string; destMin: string; sendAsset: { code: string }; destAsset: { code: string; issuer: string }; path: Array<{ isNative(): boolean }> };
  assert.equal(o.type, "pathPaymentStrictSend");
  assert.equal(o.destination, me);
  assert.equal(o.sendAsset.code, "NGNC");
  assert.equal(o.sendAmount, "10000.0000000");
  assert.equal(o.destAsset.code, "USDC");
  assert.equal(o.destAsset.issuer, "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
  assert.equal(o.destMin, "6.2000000");
  assert.equal(o.path.length, 1);
  assert.ok(o.path[0].isNative());
});

const quote = (over: Partial<Quote> = {}): Quote => ({
  id: "q_test",
  createdAt: Date.now(),
  from: "NGN",
  to: "USDC",
  amountIn: 10_000_00,
  amountOut: 6_25,
  rate: 1600,
  fee: 0,
  venues: [],
  unquoted: [],
  bestVenue: "sdex",
  expiresAt: Date.now() + 60_000,
  status: "pending",
  source: "live",
  executesOn: "sdex",
  minOut: 6_21,
  ...over,
});

const refused = (code: string) => (e: unknown) => e instanceof ApiFailure && e.code === code;

test("example prices can never be swapped for real", async () => {
  await assert.rejects(recheckSwap(s, wallet(), quote({ source: "example" })), refused("SIGNING_UNAVAILABLE"));
});

test("a quote without the DEX minimum can't be swapped", async () => {
  await assert.rejects(recheckSwap(s, wallet(), quote({ minOut: undefined })), refused("QUOTE_EXPIRED"));
  await assert.rejects(recheckSwap(s, wallet(), quote({ executesOn: "aquarius" })), refused("QUOTE_EXPIRED"));
});

test("someone off the allowlist can't swap", async () => {
  await assert.rejects(recheckSwap({ ...s, email: "c@example.com" }, wallet(), quote()), refused("NOT_INVITED"));
});

test("caps apply in the currency sold, before anything touches Horizon", async () => {
  await assert.rejects(recheckSwap(s, wallet(), quote({ amountIn: 1_000_000_00 })), refused("LIMIT_PER_PAYMENT"));
  await assert.rejects(recheckSwap(s, wallet(), quote({ from: "USDC", to: "NGN", amountIn: 1_000_00 })), refused("LIMIT_PER_PAYMENT"));
});

test("a used quote can't be swapped again", async () => {
  await assert.rejects(recheckSwap(s, wallet(), quote({ status: "approved" })), refused("ALREADY_USED"));
});

test("a landed swap is logged once and counted against today's naira cap; a repeat returns the same entry", async () => {
  const w = wallet();
  const q = quote({ id: "q_finish" });
  const before = w.spentToday.NGN;
  // Horizon is unreachable here, so the log falls back to the guaranteed minimum.
  const a = await finishSwap(w, q, "h".repeat(64));
  assert.equal(q.status, "approved");
  assert.equal(w.spentToday.NGN, before + 10_000_00);
  assert.match(a.amount, /at least/);
  assert.match(a.amount, /6\.21/);
  assert.match(a.explorerUrl!, /\/public\/tx\//);
  const b = await finishSwap(w, q, "h".repeat(64));
  assert.equal(b.id, a.id);
  assert.equal(w.spentToday.NGN, before + 10_000_00);
  assert.equal(w.activity.filter((x) => x.txRef === "h".repeat(64)).length, 1);
});
