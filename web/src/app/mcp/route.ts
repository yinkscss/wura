import { connection } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildSpikeServer, mcpSpikeEnabled } from "@/server/mcp-spike";

// SPIKE ONLY: see src/server/mcp-spike.ts. Stateless Streamable HTTP.
export const maxDuration = 60;

function notFound() {
  return new Response("Not found", { status: 404 });
}

export async function POST(req: Request) {
  if (!mcpSpikeEnabled()) return notFound();
  const baseUrl = (process.env.MCP_PUBLIC_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const server = buildSpikeServer(baseUrl);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function GET() {
  await connection(); // read env at request time, not at build
  if (!mcpSpikeEnabled()) return notFound();
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
