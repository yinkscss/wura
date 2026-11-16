import { previewSend } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const memoValue = typeof b.memo === "string" || typeof b.memo === "number" ? String(b.memo) : "";
  return previewSend(s, {
    to: String(b.to ?? ""),
    amount: Number(b.amount),
    asset: b.asset === "NGN" ? "NGN" : "USDC",
    memo: memoValue ? { type: b.memoType === "id" ? "id" : "text", value: memoValue } : undefined,
  });
});
