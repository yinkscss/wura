import "server-only";
import { randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SendIntent } from "@/lib/types";
import { approveSendFromChat } from "./channel";
import { config } from "./config";
import type { Session } from "./session";
import { withWallet } from "./store";
import { runTool } from "./tools";

/**
 * SPIKE ONLY (docs/claude-connector-plan.md, phase 1). Answers one question:
 * can an in-chat Approve button in Claude stay out of the model's reach?
 *
 * - No auth, mock mode only, one fixed demo user. Off unless MCP_SPIKE=1, and
 *   never on Vercel.
 * - `show_send_preview` (model tool) prepares a mock send and shows a card. A
 *   one-time approval code goes only in the result's `_meta`.
 * - `approve_preview` is app-only (`visibility: ["app"]`). It logs every call,
 *   whether the code matched, so we can see if the model ever reached it.
 */

const SPIKE_SESSION: Session = { userId: "mock:mcp-spike@example.com", email: "mcp-spike@example.com", address: "GSPIKE" };
const CARD_URI = "ui://wura/send-preview.html";
/** MCP Apps HTML resource type (ext-apps spec). */
const RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";

type Pending = { intentId: string; code: string };
const g = globalThis as unknown as { __wuraSpikeCodes?: Map<string, Pending>; __wuraSpikeLog?: string[] };
const codes = (g.__wuraSpikeCodes ??= new Map());
const spikeLog = (g.__wuraSpikeLog ??= []);
function note(line: string) {
  const entry = `${new Date().toISOString()} ${line}`;
  spikeLog.push(entry);
  console.log(`[mcp-spike] ${line}`);
}

export function mcpSpikeEnabled() {
  return process.env.MCP_SPIKE === "1" && !process.env.VERCEL && config.moneyMode === "mock";
}

export function spikeLogLines() {
  return [...spikeLog];
}

function cardHtml(baseUrl: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#08318D;background:transparent}
  .card{border-radius:20px;background:#fff;padding:20px;box-shadow:0 10px 30px rgba(8,49,141,.12)}
  .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#7a8bb5;font-weight:600}
  .amt{font-size:32px;font-weight:800;margin:6px 0 2px}.amt span{color:#FD91CC}
  .row{display:flex;gap:10px;margin-top:16px}
  button{flex:1;border:0;border-radius:999px;padding:12px 16px;font:inherit;font-weight:700;cursor:pointer}
  .ok{background:#08318D;color:#fff}.no{background:#eef2fb;color:#08318D}
  .msg{margin-top:12px;font-size:14px;color:#4a5a86}
</style></head>
<body><div class="card" id="card">
  <div class="k">Wura · send preview · spike (mock)</div>
  <div class="amt" id="amt">…</div>
  <div id="to" class="msg"></div>
  <div class="row"><button class="no" id="cancel">Cancel</button><button class="ok" id="approve" disabled>Approve</button></div>
  <div class="msg" id="msg"></div>
</div>
<script type="module">
  import { App } from "${baseUrl}/mcp-assets/app";
  const app = new App({ name: "Wura send preview", version: "0.0.1" });
  let pending = null;
  const $ = (id) => document.getElementById(id);
  app.ontoolresult = (result) => {
    const s = result.structuredContent || {};
    const m = result._meta || {};
    pending = { intentId: s.intentId, approvalCode: m.approvalCode };
    $("amt").innerHTML = (s.amount || "?") + ' <span>USDC</span>';
    $("to").textContent = "to " + (s.to || "?") + " · nothing moves until you tap Approve";
    $("approve").disabled = !pending.intentId || !pending.approvalCode;
  };
  $("approve").onclick = async () => {
    $("approve").disabled = true;
    $("msg").textContent = "Approving…";
    try {
      const r = await app.callServerTool({ name: "approve_preview", arguments: pending });
      $("msg").textContent = (r.content && r.content[0] && r.content[0].text) || "Done.";
    } catch (e) {
      $("msg").textContent = "Couldn't approve: " + (e && e.message ? e.message : e);
    }
  };
  $("cancel").onclick = () => { $("approve").disabled = true; $("msg").textContent = "Cancelled. Nothing was sent."; pending = null; };
  await app.connect();
</script></body></html>`;
}

export function buildSpikeServer(baseUrl: string) {
  const server = new McpServer({ name: "wura-spike", version: "0.0.1" });
  const s = SPIKE_SESSION;

  server.registerTool(
    "get_rates",
    {
      title: "Compare naira → USDC rates",
      description: "Compare naira to USDC rates across Stellar venues for an amount of naira (example prices in this spike).",
      inputSchema: { amount_naira: z.number().positive().describe("Whole naira, e.g. 50000") },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ amount_naira }) => {
      const out = await runTool(s, "get_rates", { amount_naira });
      return { content: [{ type: "text", text: out.content }], isError: out.isError };
    },
  );

  server.registerTool(
    "show_send_preview",
    {
      title: "Prepare a USDC send",
      description:
        "Prepare a USDC send preview to a saved contact (e.g. Tunde) and show it to the user. It sends nothing: the user approves on the card themselves.",
      inputSchema: { to: z.string().describe("Contact name, e.g. Tunde"), amount_usdc: z.number().positive() },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI } },
    },
    async ({ to, amount_usdc }) => {
      const out = await runTool(s, "preview_send", { to, amount_usdc });
      const card = out.card;
      if (out.isError || card?.type !== "send") {
        return { content: [{ type: "text", text: out.content }], isError: true };
      }
      const intent: SendIntent = card.intent;
      const code = randomBytes(9).toString("base64url");
      codes.set(intent.id, { intentId: intent.id, code });
      note(`preview ${intent.id} created (${amount_usdc} USDC to ${to}); code issued in _meta only`);
      return {
        content: [{ type: "text", text: `Prepared a preview: ${amount_usdc} USDC to ${intent.to.name}. The user approves it on the card. You cannot approve it.` }],
        structuredContent: { intentId: intent.id, to: intent.to.name, amount: (intent.amount / 100).toFixed(2) },
        _meta: { approvalCode: code },
      };
    },
  );

  server.registerTool(
    "approve_preview",
    {
      title: "Approve (card button only)",
      description: "Used by the preview card's Approve button.",
      inputSchema: { intentId: z.string(), approvalCode: z.string().optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: CARD_URI, visibility: ["app"] } },
    },
    async ({ intentId, approvalCode }) => {
      const p = codes.get(intentId);
      const ok = !!p && !!approvalCode && p.code === approvalCode;
      note(`approve_preview CALLED for ${intentId}: code ${ok ? "MATCHED" : approvalCode ? "WRONG" : "MISSING"}`);
      if (!ok) return { content: [{ type: "text", text: "Not approved: this button only works from the card." }], isError: true };
      codes.delete(intentId);
      const res = await withWallet(s.userId, () => approveSendFromChat(s, intentId));
      return { content: [{ type: "text", text: `Approved (mock, nothing broadcast). Reference ${res.activity?.txRef ?? "n/a"}.` }] };
    },
  );

  server.registerResource("Wura send preview", CARD_URI, { mimeType: RESOURCE_MIME_TYPE, description: "Send preview card with an Approve button" }, async () => ({
    contents: [
      {
        uri: CARD_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: cardHtml(baseUrl),
        _meta: { ui: { csp: { resourceDomains: [baseUrl] } } },
      },
    ],
  }));

  return server;
}
