import { connection } from "next/server";
import { sendPreviewCardHtml } from "@/server/mcp-card";
import { mcpSpikeEnabled } from "@/server/mcp-spike";

// SPIKE ONLY: the send-preview card with sample data, for design checks outside Claude. ?theme=dark
export async function GET() {
  await connection();
  if (!mcpSpikeEnabled()) return new Response("Not found", { status: 404 });
  const html = sendPreviewCardHtml("", {
    demo: {
      intentId: "snd_demo",
      to: "Tunde",
      toAddress: "GAYM773PAKZLAK7LRIE5KQXHMRUK3QXUVASMOAUSLTT7REJLYR7CCSVO",
      amount: "10.00",
      fee: "0.01",
      total: "10.01",
      network: "mock",
      dailyLeftAfter: "190.00",
      perPaymentCap: "50.00",
      expiresAt: Date.now() + 60_000,
    },
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
