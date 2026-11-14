import "server-only";
import type { AgentReply } from "@/lib/types";
import { money, naira, rate, usdc, usdcNumber } from "@/lib/format";
import { config } from "./config";
import { ApiFailure } from "./errors";
import {
  createPaymentLink,
  getBalances,
  getLimits,
  getQuote,
  precheckSwap,
  previewSend,
} from "./money";
import type { Session } from "./session";
import { requestSiteConnect, type ConnectResult } from "./site-connect";

/**
 * v1 chat brain: a small rule-based intent parser for the money commands.
 * It never moves money itself. It returns a quote or preview card, and money
 * only moves through approveSwap / createSend after the user approves.
 *
 * It only does money. Anything else gets a polite refusal (WhatsApp's Business
 * API rules allow task-specific bots, not general chat).
 *
 * Later: replace parsing with an LLM that calls the same typed functions.
 */

/** "50,000" | "50k" | "₦50,000" | "N50000" | "20.5" → number (major units) */
function parseAmount(raw: string): number | null {
  const m = raw.replace(/[₦$,\s]/g, "").replace(/^n(?=\d)/i, "").match(/^(\d+(?:\.\d+)?)(k|m)?$/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2]?.toLowerCase() === "k") v *= 1_000;
  if (m[2]?.toLowerCase() === "m") v *= 1_000_000;
  return Number.isFinite(v) && v > 0 ? v : null;
}

const AMT = String.raw`([₦$]?\s?n?\d[\d,]*(?:\.\d+)?\s?[km]?)`;
const DOLLARS = String.raw`(?:dollars?|usd|usdc|\$)`;
const NAIRA = String.raw`(?:naira|ngn|₦)`;

function toMinor(major: number) {
  return Math.round(major * 100);
}

function refusal(err: unknown, title: string): AgentReply {
  if (err instanceof ApiFailure) {
    return {
      text: err.message,
      card: { type: "refused", code: err.code, title, lines: [] },
    };
  }
  throw err;
}

export async function handleMessage(s: Session, message: string): Promise<AgentReply> {
  const text = message.trim();
  const t = text.toLowerCase();
  if (!t) return { text: "Tell me what you want to do with your money." };

  // Site connect: "Connect to market.example.org and buy 2 posters"
  const site = siteIntent(text);
  if (site) {
    try {
      return connectReply(requestSiteConnect(s, site));
    } catch (err) {
      return refusal(err, "Not connected");
    }
  }

  // Swap naira → USDC: "Change ₦50,000 to dollars"
  let m = t.match(new RegExp(String.raw`(?:change|swap|convert|turn)\s+${AMT}\s*${NAIRA}?\s*(?:to|into|for)\s+${DOLLARS}`, "i"));
  if (m && !/\$/.test(m[1])) {
    const amt = parseAmount(m[1]);
    if (!amt) return { text: "How much naira do you want to change?" };
    return swapReply(s, "NGN", "USDC", toMinor(amt));
  }

  // Swap USDC → naira: "Change $20 to naira"
  m = t.match(new RegExp(String.raw`(?:change|swap|convert|turn|cash out)\s+${AMT}\s*${DOLLARS}?\s*(?:to|into|for)\s+${NAIRA}`, "i"));
  if (m) {
    const amt = parseAmount(m[1]);
    if (!amt) return { text: "How many dollars do you want to change?" };
    return swapReply(s, "USDC", "NGN", toMinor(amt));
  }

  // Send: "Send $20 to Tunde"
  m = t.match(new RegExp(String.raw`(?:send|pay|transfer)\s+${AMT}\s*${DOLLARS}?\s+to\s+([a-z][a-z' -]{0,30})`, "i"));
  if (m) {
    if (/₦|naira|ngn/.test(m[1] + t)) {
      return { text: "Sends are in USDC for now. Try “Send $20 to Tunde”." };
    }
    const amt = parseAmount(m[1]);
    // A pasted Stellar address (case-sensitive, so read it from the original text).
    const addr = text.match(/\bG[A-Z2-7]{55}\b/)?.[0];
    const name = addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : m[2].trim().replace(/\s+(please|now|today)$/, "");
    if (!amt) return { text: `How much do you want to send to ${name}?` };
    try {
      const intent = await previewSend(s, { to: addr ?? name, amount: toMinor(amt), asset: "USDC" });
      return {
        text: "Ready to send. This is within your limits — confirm to go ahead.",
        card: { type: "send", intent },
      };
    } catch (err) {
      return refusal(err, "Not sent");
    }
  }

  // Payment link: "Make a payment link for ₦15,000"
  m = t.match(new RegExp(String.raw`(?:payment\s+link|pay\s+link|request|invoice)\D{0,12}?${AMT}\s*(${NAIRA}|${DOLLARS})?`, "i"));
  if (m) {
    const amt = parseAmount(m[1]);
    if (!amt) return { text: "How much should the payment link be for?" };
    const isUsd = /\$/.test(m[1]) || /dollar|usd/.test(m[2] ?? "");
    const link = createPaymentLink(s, { amount: toMinor(amt), currency: isUsd ? "USDC" : "NGN" });
    return {
      text: `Here's a payment link for ${isUsd ? usdc(link.amount) : naira(link.amount)}. Anyone with the link can pay you.`,
      card: { type: "link", link },
    };
  }

  // Best rate
  if (/\b(rate|rates|price|exchange)\b/.test(t)) {
    const amtMatch = t.match(new RegExp(AMT));
    const amt = (amtMatch && parseAmount(amtMatch[1])) || 50_000;
    try {
      const quote = await getQuote(s, { from: "NGN", to: "USDC", amountIn: toMinor(amt) });
      const best = quote.venues[0];
      return {
        text: `Right now ${best.name} has the best rate: ₦${rate(best.rate)} per USDC. Here's how the venues compare for ${naira(quote.amountIn)}.${marketNote(quote)}`,
        card: { type: "rates", quote },
      };
    } catch (err) {
      return refusal(err, "No rates");
    }
  }

  // Balance
  if (/\b(balance|how much|left|have|wallet)\b/.test(t)) {
    const balances = await getBalances(s);
    const limits = getLimits(s);
    return {
      text: `${config.moneyMode === "testnet" ? "On testnet you have" : "You have"} ${naira(balances.NGN)} and ${usdcNumber(balances.USDC)} USDC. You can still spend ${money(limits.remainingToday.NGN, "NGN")} and ${usdc(limits.remainingToday.USDC)} today.`,
      card: { type: "balance", balances, limits },
    };
  }

  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t)) {
    return { text: "Hi! I can change naira and dollars, send money, make payment links and check your balance." };
  }

  return {
    text: "I can only help with your money: change naira and dollars, send USDC, make a payment link, check rates, or check your balance.",
  };
}

async function swapReply(
  s: Session,
  from: "NGN" | "USDC",
  to: "NGN" | "USDC",
  amountIn: number,
): Promise<AgentReply> {
  try {
    precheckSwap(s, from, amountIn);
    const quote = await getQuote(s, { from, to, amountIn });
    const best = quote.venues[0];
    const count = quote.venues.length;
    const compared =
      count === 3 ? "I compared three venues." : `I compared ${count} venue${count === 1 ? "" : "s"}.`;
    const skipped = quote.unquoted.length
      ? ` ${quote.unquoted.map((u) => u.name).join(" and ")} couldn't be quoted, so I left ${quote.unquoted.length === 1 ? "it" : "them"} out.`
      : "";
    return {
      text: `${compared} ${best.name} is the best rate right now.${skipped}${marketNote(quote)}`,
      card: { type: "quote", quote },
    };
  } catch (err) {
    return refusal(err, "Not swapped");
  }
}

const DOMAIN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s,]*)?)/i;

/** Finds "connect to <site> and buy <thing>" style requests. */
function siteIntent(text: string): { url: string; want: string } | null {
  if (!/\b(connect|buy|get|purchase|go to|visit|open|mint)\b/i.test(text)) return null;
  const m = text.match(DOMAIN);
  if (!m || /@/.test(text.slice(Math.max(0, (m.index ?? 0) - 1), (m.index ?? 0)))) return null;
  // Ignore amounts like "50.5k" being read as domains.
  if (!/[a-z]{2,}$/i.test(m[1].replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))) return null;
  const rest = text.replace(m[1], " ").replace(/\s+/g, " ");
  const w = rest.match(/\b(?:buy|get|purchase|mint)\s+(?:me\s+)?(.+?)(?:\s+(?:from|on|at|there|please))?[.!?]*$/i);
  const want = (w?.[1] ?? "").trim();
  return { url: m[1], want };
}

function connectReply(r: ConnectResult): AgentReply {
  if (r.kind === "permission") {
    return {
      text: `Connect to this site? ${r.request.host} isn’t on your allow list yet.`,
      card: { type: "site-permission", request: r.request, siteName: r.siteName },
    };
  }
  if (r.kind === "declined") return { text: `OK, I won’t connect to ${r.request.host}. Nothing was sent.` };
  return {
    text: `I read ${r.action.host}, found its contract and simulated the payment. Here’s exactly what you’d sign — nothing is signed until you approve.`,
    card: { type: "site-action", action: r.action },
  };
}

export { connectReply };

/** Warns when the best live Stellar price is well below the market rate. */
function marketNote(quote: { vsMarketPct?: number; market?: { rate: number } }) {
  const pct = quote.vsMarketPct;
  if (pct === undefined || !quote.market || Math.abs(pct) < 3) return "";
  if (pct > 0) {
    return ` Note: that's ${pct.toFixed(0)}% more naira than the market rate (₦${rate(quote.market.rate)} per $1), because the naira token trades below ₦1 on Stellar. Check you can cash it out at face value.`;
  }
  return ` Heads up: that's ${Math.abs(pct).toFixed(0)}% worse than the market rate (₦${rate(quote.market.rate)} per $1). Naira liquidity on Stellar is thin right now, so check before you approve.`;
}
