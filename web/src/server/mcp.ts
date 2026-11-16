import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { naira, usdc } from "@/lib/format";
import type { Currency } from "@/lib/types";
import { chatApprovalStatus, chatApprovalsAvailable } from "./agent-key";
import { approveSendFromChat } from "./channel";
import { config, serverDevSigning, moneyLive } from "./config";
import { ApiFailure } from "./errors";
import { sendPreviewCardHtml, type CardPreview } from "./mcp-card";
import { openPreviewCount } from "./money";
import type { Scope } from "./oauth";
import type { Session } from "./session";
import { wallet, withWallet } from "./store";
import { runTool, type ToolOutcome } from "./tools";

/**
 * Wura's MCP server for Claude / ChatGPT (docs/claude-connector-plan.md).
 * Built per request for the signed-in user from the OAuth token.
 *
 * Phase 3: read tools plus "prepare" tools. A prepared send or swap comes
 * back with an approval link (/approve/<id>); the user opens it, signs in to
 * Wura and confirms there. No tool here approves, confirms or submits.
 */

/** Open (unapproved, unexpired) previews a chat app may keep per user. */
const MAX_OPEN_PREVIEWS = 5;

type Result = { content: { type: "text"; text: string }[]; isError: boolean };
const reply = (text: string, isError = false): Result => ({ content: [{ type: "text", text }], isError });

/** The in-chat Approve card (MCP Apps). */
const CARD_URI = "ui://wura/send-preview.html";
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
const sha256 = (v: string) => createHash("sha256").update(v).digest();

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fmt = (minor: number, c: Currency) => (c === "NGN" ? naira(minor) : usdc(minor));

/**
 * `inChatApprove` is true only for Claude's own connection (redirects on
 * claude.ai / claude.com). Claude was shown to keep app-only tools and `_meta`
 * out of the model's reach; other clients get the approval link only.
 */
export function buildMcpServer(s: Session, scopes: Scope[], base: string, opts: { inChatApprove?: boolean } = {}) {
  const server = new McpServer(
    { name: "wura", version: "0.3.0" },
    {
      instructions:
        "Wura is a money assistant for naira and USDC on Stellar. Use these tools to check balances, limits, rates, favourites and activity, and to prepare sends, swaps and payment links. Wura never moves money from a tool call: a prepared send or swap comes with an approval link, and nothing happens until the user opens it and confirms in Wura. Always give the user the link.",
    },
  );
  const can = (scope: Scope) => scopes.includes(scope);
  const card = !!opts.inChatApprove && can("wura.prepare");
  const approveUrl = (id: string) => `${base}/approve/${encodeURIComponent(id)}`;

  // Refusals (limits, balance, unknown contact) come back as the plain reason.
  const refusal = (out: ToolOutcome) => reply(out.note ?? out.content, true);
  const raw = async (name: string, input: Record<string, unknown>) => {
    const out = await runTool(s, name, input);
    return out.isError ? refusal(out) : reply(out.content);
  };
  const tooMany = async () => {
    const open = await withWallet(s.userId, async () => openPreviewCount(s));
    return open >= MAX_OPEN_PREVIEWS
      ? reply(`There are already ${open} previews waiting for approval. Approve or let them expire, then try again.`, true)
      : null;
  };

  if (can("wura.read")) {
    server.registerTool(
      "get_balance",
      {
        title: "Check balance and limits",
        description: "The user's naira and USDC balances, and how much they can still spend today under their limits.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => raw("get_balance", {}),
    );
    server.registerTool(
      "get_rates",
      {
        title: "Compare naira → USDC rates",
        description:
          "Compare live naira to USDC rates across Stellar venues (SDEX, Aquarius, Soroswap) for an amount of naira, with a check against the market rate. Pass on any market_check warning to the user.",
        inputSchema: { amount_naira: z.number().positive().describe("Whole naira, e.g. 50000. Use 50000 if the user gave none.") },
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      ({ amount_naira }) => raw("get_rates", { amount_naira }),
    );
    server.registerTool(
      "list_contacts",
      {
        title: "List favourites",
        description: "The user's saved favourites: names they can send to, with short addresses.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => raw("list_contacts", {}),
    );
    server.registerTool(
      "get_activity",
      {
        title: "Recent activity",
        description: "The user's recent sends, swaps and payment links, newest first. Use it to answer 'did it go through?' after they approve.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => raw("get_activity", {}),
    );
  }

  if (can("wura.prepare")) {
    server.registerTool(
      "preview_send",
      {
        title: "Prepare a USDC send",
        description:
          "Prepare a USDC send to a saved favourite (by name) or a Stellar address starting with G. It sends nothing: it returns an approval link the user must open to confirm in Wura. Give the user the link.",
        inputSchema: {
          to: z.string().min(1).describe("Favourite's name exactly as the user wrote it, or a full Stellar G… address."),
          amount_usdc: z.number().positive().describe("USDC amount in dollars, e.g. 20 or 12.5."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        ...(card ? { _meta: { ui: { resourceUri: CARD_URI } } } : {}),
      },
      async ({ to, amount_usdc }) => {
        const busy = await tooMany();
        if (busy) return busy;
        const out = await runTool(s, "preview_send", { to, amount_usdc });
        if (out.isError || out.card?.type !== "send") return refusal(out);
        const i = out.card.intent;
        const testnet = moneyLive();
        const text = reply(
          [
            `Prepared, not sent: ${usdc(i.amount)} to ${i.to.saved ? `${i.to.name} (${short(i.to.address)})` : short(i.to.address)}.`,
            i.fee ? `Fee ${usdc(i.fee)}, total ${usdc(i.total)}.` : "The network fee is paid in XLM.",
            `Network: ${testnet ? `${config.networkLabel} (${config.moneyMode === "mainnet" ? "real USDC" : "real test USDC"})` : "mock (nothing is broadcast)"}.`,
            `To send it, the user opens this link, signs in to Wura and confirms: ${approveUrl(i.id)}`,
            "If the link is opened after a minute, Wura checks everything again and shows fresh numbers before they confirm.",
            i.to.saved === false ? "This address isn't in their favourites. After it goes through they can save it with a name." : "",
            card ? "Wura also shows the user a card here with an Approve button. Only the user can tap it; you can't approve it." : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
        if (!card) return text;

        // One-time code for the card's Approve button. It goes only in _meta
        // (the card gets it; the model doesn't), and only its hash is stored.
        const code = randomBytes(18).toString("base64url");
        await withWallet(s.userId, async () => {
          (wallet(s.userId).cardCodes ??= {})[i.id] = sha256(code).toString("hex");
        });
        const inChat =
          !moneyLive() || serverDevSigning() || (chatApprovalsAvailable() && (await chatApprovalStatus(s).catch(() => null))?.active === true);
        const data: CardPreview = {
          intentId: i.id,
          to: i.to.name,
          toAddress: i.to.address,
          amount: (i.amount / 100).toFixed(2),
          fee: (i.fee / 100).toFixed(2),
          total: (i.total / 100).toFixed(2),
          network: moneyLive() ? config.stellarNetwork : "mock",
          dailyLeftAfter: (i.dailyRemainingAfter / 100).toFixed(2),
          perPaymentCap: (i.perPaymentCap / 100).toFixed(2),
          expiresAt: i.expiresAt,
          inChat,
          approveUrl: approveUrl(i.id),
        };
        return { ...text, structuredContent: data, _meta: { approvalCode: code } };
      },
    );

    if (card) {
      server.registerTool(
        "approve_send",
        {
          title: "Approve (card button only)",
          description: "Used only by the Approve button on Wura's send card. Not for the assistant.",
          inputSchema: { intentId: z.string(), approvalCode: z.string() },
          annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
          _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
        },
        async ({ intentId, approvalCode }) => {
          try {
            const res = await withWallet(s.userId, async () => {
              const codes = (wallet(s.userId).cardCodes ??= {});
              const want = codes[intentId];
              const got = sha256(approvalCode);
              if (!want || !approvalCode || !timingSafeEqual(Buffer.from(want, "hex"), got)) {
                throw new ApiFailure("NOT_APPROVED", "This button only works once, from the card Wura showed for this payment.", 403);
              }
              delete codes[intentId]; // one use, whatever happens next
              return approveSendFromChat(s, intentId);
            });
            if (!("activity" in res) || !res.activity) {
              return reply(`That needs your wallet to sign. Open it in Wura to finish: ${approveUrl(intentId)}`, true);
            }
            const a = res.activity;
            const where = a.explorerUrl ? `View it on Stellar: ${a.explorerUrl}` : `Reference ${a.txRef ?? "n/a"}${res.mock ? " (mock, nothing was broadcast)" : ""}.`;
            return { ...reply(`Sent ${a.amount} ${a.detail.replace(/^To /, "to ")}. ${where}`), structuredContent: { reference: a.txRef ?? "", explorerUrl: a.explorerUrl ?? "" } };
          } catch (err) {
            if (err instanceof ApiFailure) return reply(`${err.message} You can open it in Wura instead.`, true);
            throw err;
          }
        },
      );
      server.registerResource(
        "Wura send preview",
        CARD_URI,
        { mimeType: RESOURCE_MIME_TYPE, description: "Send preview card with an Approve button" },
        async () => ({
          contents: [
            {
              uri: CARD_URI,
              mimeType: RESOURCE_MIME_TYPE,
              text: sendPreviewCardHtml(base),
              _meta: { ui: { csp: { resourceDomains: [base, "https://fonts.googleapis.com", "https://fonts.gstatic.com"] } } },
            },
          ],
        }),
      );
    }
    server.registerTool(
      "prepare_swap",
      {
        title: "Prepare a naira ↔ USDC swap",
        description:
          "Get a swap quote between naira and USDC. It swaps nothing: it returns an approval link the user must open to approve in Wura. Give the user the link.",
        inputSchema: {
          from: z.enum(["NGN", "USDC"]).describe("Currency the user pays with. Dollars mean USDC."),
          amount: z.number().positive().describe("Amount of the `from` currency in major units, e.g. 50000 or 20.5."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      async ({ from, amount }) => {
        const busy = await tooMany();
        if (busy) return busy;
        const out = await runTool(s, "prepare_swap", { from, amount });
        if (out.isError || out.card?.type !== "quote") return refusal(out);
        const q = out.card.quote;
        return reply(
          [
            `Quote, not swapped: pay ${fmt(q.amountIn, q.from)}, get about ${fmt(q.amountOut, q.to)} via ${q.venues[0].name}.`,
            `Details: ${out.content}`,
            `To swap, the user opens this link, signs in to Wura and approves: ${approveUrl(q.id)}`,
            "If the link is opened after a minute, Wura gets a fresh quote before they approve.",
          ].join("\n"),
        );
      },
    );
    server.registerTool(
      "create_payment_link",
      {
        title: "Create a payment link",
        description: "Create a link someone else can use to pay the user. No money leaves the user's wallet.",
        inputSchema: {
          amount: z.number().positive().describe("Amount in major units, e.g. 15000 naira or 20 dollars."),
          currency: z.enum(["NGN", "USDC"]),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      ({ amount, currency }) => raw("create_payment_link", { amount, currency }),
    );
    server.registerTool(
      "save_contact",
      {
        title: "Save a favourite",
        description:
          "Save a Stellar address under a name in the user's favourites. Only when the user asks. A name already saved with a different address is refused.",
        inputSchema: {
          name: z.string().min(1).describe("The name to save, e.g. Isaac or Mum."),
          address: z.string().min(1).describe("The full Stellar G… address, exactly as the user gave it."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      ({ name, address }) => raw("save_contact", { name, address }),
    );
  }
  return server;
}
