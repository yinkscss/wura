import { cashOutSubmitCheck } from "@/server/cashout";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody } from "@/server/route";
import { submitSigned } from "@/server/testnet";

// POST { txId, signature } — the wallet's signature over a cash-out payment.
// The signature is checked, the partner is read one last time, the cash-out is
// claimed so it can't be paid twice, and the payment is submitted and logged.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return submitSigned(s, { txId: String(b.txId ?? ""), signature: String(b.signature ?? "") }, { cashOut: cashOutSubmitCheck(s, partnerToken) });
});
