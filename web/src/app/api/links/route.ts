import type { Currency } from "@/lib/types";
import { createPaymentLink, getPaymentLinks } from "@/server/money";
import { authed, jsonBody } from "@/server/route";

export const GET = authed((s) => getPaymentLinks(s));

export const POST = authed(async (s, req) => {
  const b = await jsonBody(req);
  return createPaymentLink(s, { amount: Number(b.amount), currency: b.currency as Currency });
});
