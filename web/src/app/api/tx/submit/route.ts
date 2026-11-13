import { authed, jsonBody } from "@/server/route";
import { submitSigned } from "@/server/testnet";

// Body: { txId, signature } — the user's wallet signature over the tx hash.
// The server verifies it, re-checks limits and balance, then submits to Horizon.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return submitSigned(s, { txId: String(b.txId ?? ""), signature: String(b.signature ?? "") });
});
