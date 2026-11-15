import { previewCashOut } from "@/server/ramp";
import { authed, jsonBody } from "@/server/route";

// Body: { amount } in kobo. A preview of a cash-out to the user's bank account:
// amount, fee, what reaches the bank, expiry. It signs and moves nothing; the
// payment itself needs approval like any send. The naira caps apply here too.
export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return previewCashOut(s, { amount: Number(b.amount) });
});
