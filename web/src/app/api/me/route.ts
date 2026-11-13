import type { Me } from "@/lib/types";
import { config } from "@/server/config";
import { authed } from "@/server/route";
import { wallet } from "@/server/store";

export const GET = authed((s): Me => ({
  email: s.email,
  address: s.address,
  authMode: config.authMode,
  moneyMode: config.moneyMode,
  signer: config.moneyMode === "mock" ? "mock" : config.testnetSigner,
  kycStatus: wallet(s.userId).kycStatus,
}));
