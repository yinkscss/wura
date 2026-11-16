// Lists the tools the MCP server exposes, and calls connect_site once, in-process. Nothing is sent.
// Run: [MONEY_MODE=testnet] TSX_TSCONFIG_PATH=tsconfig.test.json node --import tsx scripts/mcp-tools-check.mts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const { buildMcpServer } = await import("../src/server/mcp");
const { SCOPES } = await import("../src/server/oauth").catch(() => ({ SCOPES: null as null | string[] }));

const session = { userId: "u_mcp_check", email: "mcp@example.com", address: "GAYM773PAKZLAK7LRIE5KQXHMRUK3QXUVASMOAUSLTT7REJLYR7CCSVO" } as never;
const server = buildMcpServer(session, ["wura.read", "wura.prepare"] as never, "https://wura.example");
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "check", version: "1" });
await Promise.all([server.connect(a), client.connect(b)]);
const tools = await client.listTools();
console.log("tools:", tools.tools.map((t) => t.name).join(", "));
const r = await client.callTool({ name: "connect_site", arguments: { url: "market.example.org", want: "1 poster" } });
console.log("connect_site ->", JSON.stringify(r.content).slice(0, 400));
void SCOPES;
