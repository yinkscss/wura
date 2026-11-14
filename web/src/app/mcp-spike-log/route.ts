import { connection } from "next/server";
import { mcpSpikeEnabled, spikeLogLines } from "@/server/mcp-spike";

// SPIKE ONLY: what the server saw (preview codes issued, approve calls and whether the code matched).
export async function GET() {
  await connection(); // read env at request time, not at build
  if (!mcpSpikeEnabled()) return new Response("Not found", { status: 404 });
  return new Response(spikeLogLines().join("\n") || "(empty)", { headers: { "content-type": "text/plain" } });
}
