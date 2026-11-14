import "server-only";
import type { AgentCard, Currency, Quote } from "@/lib/types";
import { money, naira, rate, usdc } from "@/lib/format";
import { config } from "./config";
import type { ToolSpec } from "./llm";
import { ApiFailure } from "./errors";
import { createPaymentLink, getBalances, getLimits, getQuote, precheckSwap, previewSend } from "./money";
import { marketNote } from "./rules";
import type { Session } from "./session";
import { requestSiteConnect } from "./site-connect";
import { withWallet } from "./store";

/**
 * The money tools the chat brain can call. Every one of them only reads or
 * prepares something: a quote, a send preview, a payment link, a balance.
 * There is deliberately no tool that approves, confirms or submits. Money
 * only moves when the user taps Approve on a card, and those routes re-check
 * the caps and balance on the server.
 *
 * Channel-neutral on purpose: the Telegram bot and MCP server can reuse
 * TOOLS and runTool as they are.
 */

// Portable schema subset (type, properties, required, enum, description) so any
// provider accepts it. Inputs are still checked in code below.
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSpec {
  return { name, description, parameters: { type: "object", properties, required } };
}

export const TOOLS: ToolSpec[] = [
  tool(
    "get_rates",
    "Compare live naira → USDC rates across Stellar venues for an amount of naira. Use for questions about rates or prices. Shows a rate comparison card.",
    { amount_naira: { type: "number", description: "Naira amount in whole naira, e.g. 50000. Use 50000 if the user gave none." } },
    ["amount_naira"],
  ),
  tool(
    "prepare_swap",
    "Get a swap quote between naira and USDC and show it to the user to approve. It does not swap anything: the user approves on the card. Use when the user wants to change, swap or convert money.",
    {
      from: { type: "string", enum: ["NGN", "USDC"], description: "Currency the user pays with. Dollars mean USDC." },
      amount: { type: "number", description: "Amount of the `from` currency in major units (naira or dollars), e.g. 50000 or 20.5." },
    },
    ["from", "amount"],
  ),
  tool(
    "preview_send",
    "Prepare a USDC send to a saved contact (by name) or a Stellar address starting with G. Shows a preview card the user must approve; it sends nothing. Sends are USDC only.",
    {
      to: { type: "string", description: "Contact name exactly as the user wrote it, or a full Stellar G… address." },
      amount_usdc: { type: "number", description: "USDC amount in dollars, e.g. 20 or 12.5." },
    },
    ["to", "amount_usdc"],
  ),
  tool(
    "create_payment_link",
    "Create a payment link someone else can use to pay the user. No money leaves the user's wallet.",
    {
      amount: { type: "number", description: "Amount in major units, e.g. 15000 naira or 20 dollars." },
      currency: { type: "string", enum: ["NGN", "USDC"] },
    },
    ["amount", "currency"],
  ),
  tool("get_balance", "Show the user's balances and how much they can still spend today under their limits.", {}, []),
  tool(
    "connect_site",
    "Ask to connect to another Stellar site the user names (a domain) and simulate what they want to do there. Asks the user's permission first and signs nothing.",
    {
      url: { type: "string", description: "The site's domain or URL, as the user wrote it." },
      want: { type: "string", description: "What the user wants to do there, e.g. 'buy 2 posters'. Empty string if not said." },
    },
    ["url", "want"],
  ),
];

/** `note` is a plain reply to show if the model gives no text of its own. */
export type ToolOutcome = { content: string; isError: boolean; card?: AgentCard; note?: string };

/** Major units (naira, dollars) → minor units (kobo, cents). */
function toMinor(major: unknown, label: string) {
  const n = typeof major === "number" ? major : Number(major);
  if (!Number.isFinite(n) || n <= 0) throw new ApiFailure("BAD_REQUEST", `The ${label} must be a positive number.`);
  return Math.round(n * 100);
}

function currency(v: unknown): Currency {
  if (v === "NGN" || v === "USDC") return v;
  throw new ApiFailure("BAD_REQUEST", "Currency must be NGN or USDC.");
}

function quoteFacts(q: Quote) {
  const fmt = (minor: number, c: Currency) => (c === "NGN" ? naira(minor) : usdc(minor));
  const best = q.venues[0];
  return {
    you_pay: fmt(q.amountIn, q.from),
    you_get: fmt(q.amountOut, q.to),
    best_venue: best.name,
    rate: `₦${rate(best.rate)} per USDC`,
    venues: q.venues.map((v) => ({ name: v.name, gives: fmt(v.amountOut, q.to) })),
    not_compared: q.unquoted.map((u) => ({ name: u.name, reason: u.reason })),
    market_check: marketNote(q).trim() || null,
    prices: q.source === "live" ? "live Stellar mainnet prices" : "example prices (mock mode)",
    quote_valid_seconds: Math.round((q.expiresAt - Date.now()) / 1000),
  };
}

const SWAP_NOTE =
  config.moneyMode === "testnet"
    ? "This app is on Stellar testnet: swaps aren't live yet, so approving this quote will be refused. Sends are real testnet USDC."
    : "Mock mode: approving simulates the swap; nothing is broadcast.";

async function run(s: Session, name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case "get_rates": {
      const quote = await getQuote(s, { from: "NGN", to: "USDC", amountIn: toMinor(input.amount_naira, "amount") });
      return { content: JSON.stringify(quoteFacts(quote)), isError: false, card: { type: "rates", quote } };
    }
    case "prepare_swap": {
      const from = currency(input.from);
      const to: Currency = from === "NGN" ? "USDC" : "NGN";
      const amountIn = toMinor(input.amount, "amount");
      precheckSwap(s, from, amountIn);
      const quote = await getQuote(s, { from, to, amountIn });
      return {
        content: JSON.stringify({ ...quoteFacts(quote), shown_to_user: "quote card with Approve and Cancel buttons", note: SWAP_NOTE }),
        isError: false,
        card: { type: "quote", quote },
      };
    }
    case "preview_send": {
      const intent = await previewSend(s, { to: String(input.to ?? ""), amount: toMinor(input.amount_usdc, "amount"), asset: "USDC" });
      return {
        content: JSON.stringify({
          to: intent.to.name,
          amount: usdc(intent.amount),
          fee: usdc(intent.fee),
          total: usdc(intent.total),
          network: config.moneyMode === "testnet" ? "Stellar testnet (real test USDC)" : "mock (nothing is broadcast)",
          shown_to_user: "send preview card with Confirm and Cancel buttons; nothing is sent until they confirm",
        }),
        isError: false,
        card: { type: "send", intent },
      };
    }
    case "create_payment_link": {
      const link = createPaymentLink(s, { amount: toMinor(input.amount, "amount"), currency: currency(input.currency) });
      return {
        content: JSON.stringify({
          amount: money(link.amount, link.currency),
          url: link.url,
          note: "Example link on a reserved test domain; it isn't a working payment page yet.",
        }),
        isError: false,
        card: { type: "link", link },
      };
    }
    case "get_balance": {
      const balances = await getBalances(s);
      const limits = getLimits(s);
      return {
        content: JSON.stringify({
          network: config.moneyMode === "testnet" ? "Stellar testnet" : "mock",
          naira: naira(balances.NGN),
          usdc: usdc(balances.USDC),
          can_still_spend_today: { naira: naira(limits.remainingToday.NGN), usdc: usdc(limits.remainingToday.USDC) },
          per_payment_limit: { naira: naira(limits.perPayment.NGN), usdc: usdc(limits.perPayment.USDC) },
          limits_are_examples: true,
        }),
        isError: false,
        card: { type: "balance", balances, limits },
      };
    }
    case "connect_site": {
      const r = requestSiteConnect(s, { url: String(input.url ?? ""), want: String(input.want ?? "") });
      if (r.kind === "permission") {
        return {
          content: JSON.stringify({ status: "asking the user for permission", host: r.request.host }),
          isError: false,
          card: { type: "site-permission", request: r.request, siteName: r.siteName },
        };
      }
      if (r.kind === "declined") {
        return { content: JSON.stringify({ status: "the user declined this site before", host: r.request.host }), isError: false };
      }
      return {
        content: JSON.stringify({ status: "simulated; nothing signed until the user approves", host: r.action.host }),
        isError: false,
        card: { type: "site-action", action: r.action },
      };
    }
    default:
      return { content: `Unknown tool ${name}.`, isError: true };
  }
}

/**
 * Runs one tool in its own locked wallet transaction, so the slow model call
 * around it never holds the user's row lock. Refusals (caps, balance, unknown
 * contact) come back as an error result plus a refusal card.
 */
export async function runTool(s: Session, name: string, input: unknown): Promise<ToolOutcome> {
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  try {
    return await withWallet(s.userId, () => run(s, name, args));
  } catch (err) {
    if (err instanceof ApiFailure) {
      const title = name === "preview_send" ? "Not sent" : name === "prepare_swap" ? "Not swapped" : name === "connect_site" ? "Not connected" : "Couldn't do that";
      return {
        content: JSON.stringify({ refused: err.code, message: err.message }),
        isError: true,
        card: { type: "refused", code: err.code, title, lines: [] },
        note: err.message,
      };
    }
    throw err;
  }
}
