import { createOnrampOrder } from "@/server/paycrest";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return createOnrampOrder(s, { amount: Number(b.amount) });
});
