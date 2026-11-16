import { orPartnerSignIn, prepareCashOutPayment } from "@/server/cashout";
import { receiveChoice } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody } from "@/server/route";

// POST { id, from } — once the cash-out's status says readyToPay: the exact
// payment the partner asks for, read fresh from the partner and checked against
// the cash-out Wura recorded, the caps and the balance. A preview only: nothing
// is signed. Lives under /api/funding so the partner sign-in cookie arrives.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  // A lapsed partner sign-in answers "needs_partner_signin"; the screen signs it and asks again.
  return orPartnerSignIn(() => prepareCashOutPayment(s, { id: String(b.id ?? ""), from: receiveChoice(b.from) }, partnerToken));
});
