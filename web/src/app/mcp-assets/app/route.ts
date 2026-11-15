import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The MCP Apps browser bundle (@modelcontextprotocol/ext-apps) for the
// in-chat Approve card. The card runs in Claude's sandboxed iframe and imports
// this as a module, so it needs CORS. next.config.ts traces the file.
export async function GET() {
  await connection();
  const js = await readFile(join(process.cwd(), "node_modules/@modelcontextprotocol/ext-apps/dist/src/app-with-deps.js"), "utf8");
  return new Response(js, {
    headers: { "content-type": "text/javascript; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=3600" },
  });
}
