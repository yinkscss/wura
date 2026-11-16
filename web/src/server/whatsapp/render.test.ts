import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentCard } from "@/lib/types";
import { parseButton, renderCard, renderReply } from "./render";

test("parseButton accepts approve and cancel ids", () => {
  assert.deepEqual(parseButton("ap:q_abc"), { action: "ap", id: "q_abc" });
  assert.deepEqual(parseButton("cx:snd_1"), { action: "cx", id: "snd_1" });
  assert.equal(parseButton("yes"), null);
  assert.equal(parseButton("ap:"), null);
});

test("quote card has Approve and Cancel buttons", () => {
  const card: AgentCard = {
    type: "quote",
    quote: {
      id: "q_demo",
      from: "NGN",
      to: "USDC",
      amountIn: 5_000_000,
      amountOut: 3120,
      rate: 1602.5,
      fee: 0,
      venues: [{ venue: "aquarius", name: "Aquarius", amountOut: 3120, rate: 1602.5, best: true }],
      unquoted: [],
      bestVenue: "aquarius",
      expiresAt: Date.now() + 60_000,
      status: "pending",
      source: "example",
    },
  };
  const r = renderCard(card);
  assert.match(r.text, /Aquarius/);
  assert.equal(r.buttons?.length, 2);
  assert.equal(r.buttons?.[0]?.title, "Approve");
  assert.equal(parseButton(r.buttons?.[0]?.id)?.action, "ap");
  assert.equal(parseButton(r.buttons?.[1]?.id)?.action, "cx");
});

test("site cards have no WhatsApp buttons", () => {
  const card: AgentCard = {
    type: "site-permission",
    siteName: "Demo Shop",
    request: { id: "req_1", host: "shop.example", want: "buy", createdAt: Date.now() } as never,
  };
  const r = renderCard(card);
  assert.equal(r.buttons, undefined);
  assert.match(r.text, /isn't available yet/);
});

test("renderReply puts agent text above the card", () => {
  const r = renderReply({
    text: "Here's a quote.",
    card: {
      type: "balance",
      balances: { NGN: 100_000, USDC: 500 },
      limits: {
        remainingToday: { NGN: 50_000, USDC: 200 },
        perPayment: { NGN: 20_000, USDC: 100 },
        daily: { NGN: 100_000, USDC: 500 },
      } as never,
    },
  });
  assert.match(r.text, /^Here's a quote\./);
  assert.match(r.text, /Balance:/);
});
