import "server-only";
import { money, naira, rate, shortAddress, usdc } from "@/lib/format";
import type { AgentCard, AgentReply, Quote } from "@/lib/types";

/**
 * Channel-neutral card text and button specs. Telegram and WhatsApp each turn
 * these into their own message format. Money buttons use short actions; the
 * id is only looked up inside the tapping user's own wallet.
 */

export type CardButtonAction =
  | "ap" // approve send or swap
  | "cx" // cancel send or swap
  | "sc" // connect to a site
  | "sd" // don't connect
  | "sa" // approve a site action
  | "sx"; // cancel a site action

export type CardButton = { label: string; action: CardButtonAction; id: string };

export type CardView = { text: string; buttons?: CardButton[] };

const fmt = (minor: number, c: "NGN" | "USDC") => (c === "NGN" ? naira(minor) : usdc(minor));

function quoteLines(q: Quote): string[] {
  const lines = [
    `${money(q.amountIn, q.from)} → ${money(q.amountOut, q.to)}`,
    `Best rate: ₦${rate(q.rate)} per USDC on ${q.venues.find((v) => v.best)?.name ?? "the best venue"}`,
  ];
  if (q.vsMarketPct !== undefined && q.vsMarketPct < -1) {
    lines.push(`Heads up: that is ${Math.abs(q.vsMarketPct).toFixed(1)}% worse than the market rate.`);
  }
  return lines;
}

/** Plain-text view of one AgentCard, plus optional Approve/Cancel-style buttons. */
export function cardView(card: AgentCard): CardView {
  switch (card.type) {
    case "rates": {
      const q = card.quote;
      const lines = [`Rates for ${money(q.amountIn, q.from)}:`];
      for (const v of q.venues) lines.push(`${v.best ? "★ " : "  "}${v.name}: ${fmt(v.amountOut, q.to)} (₦${rate(v.rate)} per USDC)`);
      for (const u of q.unquoted) lines.push(`Not compared: ${u.name} (${u.reason})`);
      if (q.vsMarketPct !== undefined && q.vsMarketPct < -1) {
        lines.push(`The best quote is ${Math.abs(q.vsMarketPct).toFixed(1)}% worse than the market rate.`);
      }
      lines.push(q.source === "live" ? "Live prices." : "Example prices (mock mode).");
      return { text: lines.join("\n") };
    }
    case "quote": {
      const q = card.quote;
      return {
        text: [
          ...quoteLines(q),
          `Valid for about ${Math.max(0, Math.round((q.expiresAt - Date.now()) / 1000))} seconds. Nothing moves until you approve.`,
        ].join("\n"),
        buttons: [
          { label: "Approve", action: "ap", id: q.id },
          { label: "Cancel", action: "cx", id: q.id },
        ],
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
        buttons: [
          { label: "Confirm", action: "ap", id: i.id },
          { label: "Cancel", action: "cx", id: i.id },
        ],
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
        buttons: [
          { label: "Connect", action: "sc", id: card.request.id },
          { label: "Not now", action: "sd", id: card.request.id },
        ],
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
        buttons: [
          { label: "Approve", action: "sa", id: a.id },
          { label: "Cancel", action: "sx", id: a.id },
        ],
      };
    }
    case "save-contact":
      return { text: `Want to save this address as a favourite?\n${card.address}\nTell me a name, like: save it as Isaac.` };
  }
}

/** Agent text first, then its card, if any. */
export function replyView(reply: AgentReply): CardView {
  if (!reply.card) return { text: reply.text };
  const card = cardView(reply.card);
  return { text: [reply.text, card.text].filter(Boolean).join("\n\n"), buttons: card.buttons };
}
