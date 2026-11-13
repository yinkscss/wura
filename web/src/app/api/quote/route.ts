import type { Currency } from "@/lib/types";
import { getQuote } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return getQuote(s, {
    from: b.from as Currency,
    to: b.to as Currency,
    amountIn: Number(b.amountIn),
  });
});
