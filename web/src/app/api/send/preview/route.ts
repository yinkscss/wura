import { previewSend } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return previewSend(s, { to: String(b.to ?? ""), amount: Number(b.amount), asset: "USDC" });
});
