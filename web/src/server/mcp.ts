import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Scope } from "./oauth";
import type { Session } from "./session";
import { runTool } from "./tools";

/**
 * Wura's MCP server for Claude / ChatGPT (docs/claude-connector-plan.md).
 * Built per request for the signed-in user from the OAuth token.
 *
 * Phase 2: read-only tools. Preparing sends and swaps, and the in-chat
 * Approve card, come in phases 3 and 4. No tool here ever moves money.
 */
export function buildMcpServer(s: Session, scopes: Scope[]) {
  const server = new McpServer(
    { name: "wura", version: "0.2.0" },
    {
      instructions:
        "Wura is a money assistant for naira and USDC on Stellar. Use these tools to check balances, limits, rates and favourites. Wura never moves money from a tool call: every swap or send needs the user's own approval in Wura.",
    },
  );
  const can = (scope: Scope) => scopes.includes(scope);

  const text = async (name: string, input: Record<string, unknown>) => {
    const out = await runTool(s, name, input);
    return { content: [{ type: "text" as const, text: out.content }], isError: out.isError };
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
      () => text("get_balance", {}),
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
      ({ amount_naira }) => text("get_rates", { amount_naira }),
    );
    server.registerTool(
      "list_contacts",
      {
        title: "List favourites",
        description: "The user's saved favourites: names they can send to, with short addresses.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      () => text("list_contacts", {}),
    );
  }
  return server;
}
