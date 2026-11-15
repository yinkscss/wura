import { cashOutStatus, receiveChoice, startCashOut } from "@/server/ramp";
import { partnerToken } from "@/server/ramp/cookie";
import { authed, jsonBody, signedIn } from "@/server/route";

// POST { amount, from? } — start a cash-out to a naira bank account. `from`
// ("NGN" or "USDC") is what leaves the wallet; `amount` is in that currency,
// minor units. Answers a mock preview, { status: "needs_partner_signin", … }
// (sign, post to ../signin, call again) or { status: "open_partner_page", url },
// where the user enters the bank account. Nothing moves here.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  const from = receiveChoice(b.from);
  return startCashOut(s, { amount: Number(b.amount), from, partnerToken: await partnerToken(from) });
});

// GET ?id=<cash-out id>&from=<NGN|USDC> — where a live cash-out has got to.
// `readyToPay` means the partner is waiting for the wallet's payment, which
// needs the user's approval and goes through the money code, not this route.
export const GET = signedIn(async (s, req) => {
  const q = req.nextUrl.searchParams;
  const from = receiveChoice(q.get("from"));
  return cashOutStatus(s, { id: q.get("id") ?? "", from, partnerToken: await partnerToken(from) });
});
