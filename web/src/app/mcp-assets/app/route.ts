import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mcpSpikeEnabled } from "@/server/mcp-spike";

// SPIKE ONLY: serves the MCP Apps browser bundle to the card iframe.
export async function GET() {
  await connection(); // read env at request time, not at build
  if (!mcpSpikeEnabled()) return new Response("Not found", { status: 404 });
  const js = await readFile(join(process.cwd(), "node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"), "utf8");
  return new Response(js, {
    headers: { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=300" },
  });
}
