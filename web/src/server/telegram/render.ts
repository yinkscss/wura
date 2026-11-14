import "server-only";
import { money, naira, rate, shortAddress, usdc } from "@/lib/format";
import type { AgentCard, AgentReply, Quote } from "@/lib/types";
import type { InlineKeyboard } from "./api";

/**
 * Turns the chat brain's reply (text plus an optional card) into a Telegram
 * message: plain text and inline buttons. Plain text on purpose, so there is
 * nothing to escape. Every AgentCard variant is covered.
 *
 * Button data is "<action>:<id>", at most 64 bytes (Telegram's cap). The id is
 * only looked up inside the tapping user's own wallet; it grants nothing.
 */

export type Rendered = { text: string; keyboard?: InlineKeyboard };

export type ButtonAction =
  | "ap" // approve a send or swap (the id's prefix says which)
  | "cx" // cancel a send or swap
  | "sc" // connect to a site
  | "sd" // don't connect
  | "sa" // approve a site action
  | "sx"; // cancel a site action

const ACTIONS = new Set<string>(["ap", "cx", "sc", "sd", "sa", "sx"]);
const MAX_CALLBACK_BYTES = 64;

export function encodeButton(action: ButtonAction, id: string): string {
  const data = `${action}:${id}`;
  if (Buffer.byteLength(data) > MAX_CALLBACK_BYTES) throw new Error("callback data too long");
  return data;
}

export function parseButton(data: unknown): { action: ButtonAction; id: string } | null {
  if (typeof data !== "string" || Buffer.byteLength(data) > MAX_CALLBACK_BYTES) return null;
  const i = data.indexOf(":");
  if (i < 1) return null;
  const action = data.slice(0, i);
  const id = data.slice(i + 1);
  if (!ACTIONS.has(action) || !/^[A-Za-z0-9_-]{1,50}$/.test(id)) return null;
  return { action: action as ButtonAction, id };
}

const fmt = (minor: number, c: "NGN" | "USDC") => (c === "NGN" ? naira(minor) : usdc(minor));

function quoteLines(q: Quote): string[] {
  const lines = [`${money(q.amountIn, q.from)} → ${money(q.amountOut, q.to)}`, `Best rate: ₦${rate(q.rate)} per USDC on ${q.venues.find((v) => v.best)?.name ?? "the best venue"}`];
  if (q.vsMarketPct !== undefined && q.vsMarketPct < -1) {
    lines.push(`Heads up: that is ${Math.abs(q.vsMarketPct).toFixed(1)}% worse than the market rate.`);
  }
  return lines;
}

function renderCard(card: AgentCard): Rendered {
  switch (card.type) {
    case "rates": {
      const q = card.quote;
      const lines = [`Rates for ${money(q.amountIn, q.from)}:`];
      for (const v of q.venues) lines.push(`${v.best ? "★ " : "  "}${v.name}: ${fmt(v.amountOut, q.to)} (₦${rate(v.rate)} per USDC)`);
      for (const u of q.unquoted) lines.push(`Not compared: ${u.name} (${u.reason})`);
      if (q.vsMarketPct !== undefined && q.vsMarketPct < -1) lines.push(`The best quote is ${Math.abs(q.vsMarketPct).toFixed(1)}% worse than the market rate.`);
      lines.push(q.source === "live" ? "Live prices." : "Example prices (mock mode).");
      return { text: lines.join("\n") };
    }
    case "quote": {
      const q = card.quote;
      return {
        text: [...quoteLines(q), `Valid for about ${Math.max(0, Math.round((q.expiresAt - Date.now()) / 1000))} seconds. Nothing moves until you approve.`].join("\n"),
        keyboard: [[{ text: "Approve", callback_data: encodeButton("ap", q.id) }, { text: "Cancel", callback_data: encodeButton("cx", q.id) }]],
      };
    }
    case "send": {
      const i = card.intent;
      const to = i.to.saved === false ? `${i.to.name} (not saved)` : `${i.to.name} (${shortAddress(i.to.address)})`;
      return {
        text: [
          `Send ${usdc(i.amount)} to ${to}`,
          `Fee: ${usdc(i.fee)} · Total: ${usdc(i.total)}`,
          `You can still spend ${usdc(Math.max(0, i.dailyRemainingAfter))} today after this.`,
          "Nothing is sent until you confirm.",
        ].join("\n"),
        keyboard: [[{ text: "Confirm", callback_data: encodeButton("ap", i.id) }, { text: "Cancel", callback_data: encodeButton("cx", i.id) }]],
      };
    }
    case "link": {
      const l = card.link;
      return { text: `Payment link for ${money(l.amount, l.currency)}:\n${l.url}` };
    }
    case "balance": {
      const { balances: b, limits: l } = card;
      return {
        text: [
          `Balance: ${naira(b.NGN)} and ${usdc(b.USDC)}`,
          `Left to spend today: ${naira(l.remainingToday.NGN)} / ${usdc(l.remainingToday.USDC)}`,
          `Per payment: ${naira(l.perPayment.NGN)} / ${usdc(l.perPayment.USDC)} (example limits)`,
        ].join("\n"),
      };
    }
    case "refused":
      return { text: [card.title, ...card.lines].join("\n") };
    case "site-permission":
      return {
        text: `Connect to ${card.siteName} (${card.request.host})?${card.request.want ? `\nYou want to: ${card.request.want}` : ""}\nThis only lets me look at the site. It doesn't let anything be signed.`,
        keyboard: [[{ text: "Connect", callback_data: encodeButton("sc", card.request.id) }, { text: "Not now", callback_data: encodeButton("sd", card.request.id) }]],
      };
    case "site-action": {
      const a = card.action;
      return {
        text: [
          `${a.siteName}: ${a.summary}`,
          `Call: ${a.call.fn} on ${shortAddress(a.contract.address)}${a.contract.verified ? "" : " (not verified)"}`,
          `Price: ${usdc(a.price)} · Fee: ${usdc(a.fee)} · Total: ${usdc(a.total)}`,
          "Nothing is signed until you approve.",
        ].join("\n"),
        keyboard: [[{ text: "Approve", callback_data: encodeButton("sa", a.id) }, { text: "Cancel", callback_data: encodeButton("sx", a.id) }]],
      };
    }
    case "save-contact":
      return { text: `Want to save this address as a favourite?\n${card.address}\nTell me a name, like: save it as Isaac.` };
  }
}

/** The agent's text first, then its card, if any. */
export function renderReply(reply: AgentReply): Rendered {
  if (!reply.card) return { text: reply.text };
  const card = renderCard(reply.card);
  return { text: [reply.text, card.text].filter(Boolean).join("\n\n"), keyboard: card.keyboard };
}

export { renderCard };
