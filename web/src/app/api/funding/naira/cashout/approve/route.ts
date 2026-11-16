import { approveCashOutPayment, orPartnerSignIn } from "@/server/cashout";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody } from "@/server/route";

// POST { intentId, approve: true } — reads the partner again, re-checks the
// caps and the balance, and answers { status: "needs_signature", txId, hash }.
// The wallet signs the hash; the signature goes to ../submit, not /api/tx/submit.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  // A lapsed partner sign-in answers "needs_partner_signin"; the preview stays open for after it.
  return orPartnerSignIn(() => approveCashOutPayment(s, { intentId: String(b.intentId ?? ""), approve: b.approve }, partnerToken));
});
