import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentCard, Limits, Quote, SendIntent } from "@/lib/types";
import { encodeButton, parseButton, renderCard, renderReply } from "./render";

const quote: Quote = {
  id: "q_AbCdEfGhIjKl",
  from: "NGN",
  to: "USDC",
  amountIn: 5_000_000,
  amountOut: 3_120,
  rate: 1602.5,
  fee: 0,
  venues: [
    { venue: "sdex", name: "SDEX", amountOut: 3_100, rate: 1612, best: false },
    { venue: "aquarius", name: "Aquarius", amountOut: 3_120, rate: 1602.5, best: true },
  ],
  unquoted: [{ venue: "soroswap", name: "Soroswap", reason: "unreachable" }],
  bestVenue: "aquarius",
  expiresAt: Date.now() + 60_000,
  status: "pending",
  source: "example",
};
const intent: SendIntent = {
  id: "snd_AbCdEfGhIjKl",
  to: { name: "Tunde", address: "GBTUNDEEXAMPLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
  asset: "USDC",
  amount: 2_000,
  fee: 1,
  total: 2_001,
  balanceBefore: 24_860,
  dailyRemainingAfter: 10_000,
  dailyLimit: 50_000,
  perPaymentCap: 20_000,
  expiresAt: Date.now() + 60_000,
  status: "pending",
};

const limits: Limits = { example: true, daily: { NGN: 1, USDC: 1 }, perPayment: { NGN: 1, USDC: 1 }, spentToday: { NGN: 0, USDC: 0 }, remainingToday: { NGN: 1, USDC: 1 } };

const cards: AgentCard[] = [
  { type: "quote", quote },
  { type: "send", intent },
  { type: "link", link: { id: "lnk_1", code: "8F2K-15K", url: "https://example.com/p/8F2K-15K", amount: 1_500_000, currency: "NGN", status: "open", createdAt: 0, expiresAt: 1 } },
  { type: "balance", balances: { NGN: 100_00, USDC: 5_00 }, limits },
  { type: "rates", quote },
  { type: "refused", code: "LIMIT_DAILY", title: "Not sent", lines: ["Over today's limit."] },
  { type: "site-permission", request: { id: "sr_AbCdEfGhIjKl", host: "market.example.org", url: "https://market.example.org", want: "buy 2 posters", createdAt: 0, status: "pending" }, siteName: "Example Market" },
  {
    type: "site-action",
    action: {
      id: "sa_AbCdEfGhIjKl", host: "market.example.org", siteName: "Example Market", want: "buy", contract: { address: "CABCDEFGHIJKLMNOP", verified: true, name: "Shop" },
      call: { fn: "buy", args: [] }, steps: [], summary: "Buys 2 posters.", asset: "USDC", price: 1_000, fee: 1, total: 1_001,
      balanceBefore: 1, dailyRemainingAfter: 1, dailyLimit: 1, perPaymentCap: 1, expiresAt: 1, status: "pending",
    },
  },
  { type: "save-contact", address: "GBTUNDEEXAMPLEXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" },
];

test("every card variant renders text, and button data fits Telegram's 64 bytes", () => {
  for (const card of cards) {
    const r = renderCard(card);
    assert.ok(r.text.length > 0, card.type);
    for (const row of r.keyboard ?? []) {
      for (const b of row) {
        assert.ok(Buffer.byteLength(b.callback_data) <= 64, `${card.type}: ${b.callback_data}`);
        assert.ok(parseButton(b.callback_data), `${card.type}: parses`);
      }
    }
  }
});

test("money cards carry approve and cancel buttons; info cards carry none", () => {
  assert.equal(renderCard({ type: "quote", quote }).keyboard?.[0].length, 2);
  assert.equal(renderCard({ type: "send", intent }).keyboard?.[0].length, 2);
  assert.equal(renderCard({ type: "rates", quote }).keyboard, undefined);
  assert.equal(renderCard({ type: "balance", balances: { NGN: 0, USDC: 0 }, limits }).keyboard, undefined);
});

test("approve buttons point at the card's own id", () => {
  const send = renderCard({ type: "send", intent }).keyboard![0][0].callback_data;
  assert.equal(send, `ap:${intent.id}`);
  assert.equal(renderCard({ type: "quote", quote }).keyboard![0][1].callback_data, `cx:${quote.id}`);
});

test("parseButton rejects junk, unknown actions and oversized data", () => {
  assert.equal(parseButton(undefined), null);
  assert.equal(parseButton("ap"), null);
  assert.equal(parseButton("zz:snd_abc"), null);
  assert.equal(parseButton("ap:snd abc"), null);
  assert.equal(parseButton("ap:" + "a".repeat(80)), null);
  assert.deepEqual(parseButton("ap:snd_abc-_1"), { action: "ap", id: "snd_abc-_1" });
  assert.throws(() => encodeButton("ap", "x".repeat(80)));
});

test("renderReply puts text before the card", () => {
  const r = renderReply({ text: "Here you go.", card: { type: "send", intent } });
  assert.ok(r.text.startsWith("Here you go."));
  assert.ok(r.keyboard);
  assert.equal(renderReply({ text: "Hi" }).keyboard, undefined);
});
