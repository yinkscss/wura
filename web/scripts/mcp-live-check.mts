// MCP chain on testnet, in-process: connect_site (permission link) -> allow -> connect_site (contracts)
// -> prepare_site_call (approval link). Nothing is signed. The caller plays the assistant.
// Run (see demo/soroban-shop/README.md for env): node --import tsx scripts/mcp-live-check.mts <buyer address> <site host> <shop contract>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
const { buildMcpServer } = await import("../src/server/mcp");
const { respondToConnect } = await import("../src/server/site-connect");
const { withWallet } = await import("../src/server/store");

const [address, host, shop] = process.argv.slice(2);
const session = { userId: "u_mcp_live", email: "mcp-live@example.com", address } as never;
const server = buildMcpServer(session, ["wura.read", "wura.prepare"] as never, "https://wura.example");
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "check", version: "1" });
await Promise.all([server.connect(a), client.connect(b)]);
const text = (r: unknown) => ((r as { content: Array<{ text: string }> }).content[0].text);

const first = text(await client.callTool({ name: "connect_site", arguments: { url: host, want: "2 posters" } }));
console.log("1) connect_site:", first.slice(0, 230));
const reqId = first.match(/approve\/(sr_[\w-]+)/)?.[1];
if (!reqId) throw new Error("no permission link");
await withWallet(session.userId, async () => respondToConnect(session, { requestId: reqId, connect: true, remember: false }));
const second = text(await client.callTool({ name: "connect_site", arguments: { url: host, want: "2 posters" } }));
const parsed = JSON.parse(second);
console.log("2) after allow:", parsed.status, "| contracts:", parsed.contracts.map((c: { address: string; functions: Array<{ name: string }> }) => `${c.address.slice(0, 6)}… [${c.functions.map((f) => f.name).join(",")}]`).join(" "), "| your_address ok:", parsed.your_address === address);
const prep = text(await client.callTool({ name: "prepare_site_call", arguments: { url: host, contract: shop, function: "buy", args: JSON.stringify({ buyer: address, qty: 2 }), want: "2 posters" } }));
console.log("3) prepare_site_call:", prep.replace(/\n/g, " | "));
const wrong = await client.callTool({ name: "prepare_site_call", arguments: { url: host, contract: "CBYBFNHFOWWCIHX6XMHC6EENHORNQG4LNSAHUMWVPNM4XJOR7YHY7JDS", function: "transfer", args: "{}", want: "" } });
console.log("4) contract the site doesn't mention:", text(wrong).slice(0, 140), "| isError:", (wrong as { isError?: boolean }).isError);
