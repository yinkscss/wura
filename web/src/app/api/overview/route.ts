import { config } from "@/server/config";
import { getActivity, getBalances, getLimits, getPaymentLinks } from "@/server/money";
import { authed } from "@/server/route";
import { wallet } from "@/server/store";

export const GET = authed((s) => ({
  me: {
    email: s.email,
    address: s.address,
    authMode: config.authMode,
    moneyMode: config.moneyMode,
    kycStatus: wallet(s.userId).kycStatus,
  },
  balances: getBalances(s),
  limits: getLimits(s),
  activity: getActivity(s),
  links: getPaymentLinks(s),
}));
