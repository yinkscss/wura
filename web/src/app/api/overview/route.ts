import { config } from "@/server/config";
import { getActivity, getBalances, getLimits, getPaymentLinks } from "@/server/money";
import { authed } from "@/server/route";
import { wallet } from "@/server/store";
import { recordUser } from "@/server/users";

export const GET = authed(async (s) => {
  await recordUser(s);
  return {
  me: {
    email: s.email,
    address: s.address,
    authMode: config.authMode,
    moneyMode: config.moneyMode,
    signer: config.moneyMode === "mock" ? "mock" : config.testnetSigner,
    kycStatus: wallet(s.userId).kycStatus,
  },
  balances: await getBalances(s),
  limits: getLimits(s),
  activity: getActivity(s),
  links: getPaymentLinks(s),
  };
});
