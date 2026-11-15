import "server-only";
import { Networks } from "@stellar/stellar-sdk";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { loadAnchor, type AnchorEndpoints, type AnchorPin } from "./sep1";
import { ChallengeError, checkChallenge, exchangeChallenge, fetchChallenge, readAnchorToken, signChallenge } from "./sep10";
import { getInfo, getTransfer, startInteractive, type Sep24Info } from "./sep24";
import type { PartnerSignIn, RampCurrency, RampProvider } from "./types";

/**
 * LINK, on Stellar MAINNET. In both of its services the user pays NAIRA by
 * bank transfer on LINK's hosted page, which also collects identity and bank
 * details, so Wura never handles them. What differs is what lands in the
 * wallet:
 *
 *   NGN  — ngnc.online: naira stays naira (the NGNC token). This is the
 *          wallet's naira balance.
 *   USDC — anchor.linkio.world: naira arrives as dollars (USDC), with no swap.
 *          Selling NGNC for USDC on the open market lost about a third on
 *          small amounts on 13 Nov 2026 (docs/money-side.md), so "naira in,
 *          dollars out" goes through this one.
 *
 * Both run SEP-10 sign-in and SEP-24, with separate domains and signing keys,
 * so each has its own pin and its own partner session.
 *
 * What is switched on in this version: reading limits, signing in to the
 * partner, starting a top-up and reading its status. Cash-outs are refused
 * until the approval hook exists (docs/money-side.md, "Plan").
 *
 * Both are open: no key or agreement is needed to call them, and nothing is
 * agreed with LINK. Customer-facing text says "partner" and does not name it.
 * No real top-up has been completed through either yet.
 */

type LinkService = { pin: AnchorPin; asset: { code: string; issuer: string } };

export const LINK: Record<RampCurrency, LinkService> = {
  /** Recorded from https://ngnc.online/.well-known/stellar.toml on 13 Nov 2026. */
  NGN: {
    pin: {
      homeDomain: "ngnc.online",
      networkPassphrase: Networks.PUBLIC,
      signingKey: "GCQLPBWOQ5PAJYEEQBE7GDSY7X3LCYKFEBKOCNF3OUA6F74ORK74HVSQ",
    },
    asset: { code: "NGNC", issuer: "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6" },
  },
  /** Recorded from https://anchor.linkio.world/.well-known/stellar.toml on 14 Nov 2026. USDC is Circle's. */
  USDC: {
    pin: {
      homeDomain: "anchor.linkio.world",
      networkPassphrase: Networks.PUBLIC,
      signingKey: "GC2MQRX47W5HQOBQPRE6A6ULZIJ5NGDJKDK7NYKNX3HY5OQSOGKOJC7D",
    },
    asset: { code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" },
  },
};

/** Mainnet Horizon, read-only: used to check the wallet can receive before a top-up starts. */
const MAINNET_HORIZON = "https://horizon.stellar.org";

const CACHE_MS = 5 * 60 * 1000;
type Loaded = { at: number; anchor: AnchorEndpoints; info: Sep24Info };
const cached: Partial<Record<RampCurrency, Loaded>> = {};

function unreachable(err: unknown): never {
  if (err instanceof ApiFailure) throw err;
  // The reason is for us, not for the customer.
  console.error("[ramp:link]", err);
  throw new ApiFailure("BAD_REQUEST", "The naira partner can't be reached right now. Nothing was sent.", 502);
}

/** One service's validated endpoints and published limits, cached for five minutes. */
export async function linkAnchor(receive: RampCurrency): Promise<Loaded> {
  const hit = cached[receive];
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  try {
    const anchor = await loadAnchor(LINK[receive].pin);
    const info = await getInfo(anchor.transferServer, LINK[receive].asset.code);
    return (cached[receive] = { at: Date.now(), anchor, info });
  } catch (err) {
    unreachable(err);
  }
}

function expectation(anchor: AnchorEndpoints, account: string) {
  return {
    account,
    signingKey: anchor.signingKey,
    networkPassphrase: anchor.networkPassphrase,
    homeDomain: anchor.homeDomain,
    webAuthDomain: anchor.webAuthDomain,
  };
}

/** Asks the partner for a sign-in challenge and checks it before the wallet is asked to sign. */
async function signInStart(s: Session, receive: RampCurrency): Promise<PartnerSignIn> {
  const { anchor } = await linkAnchor(receive);
  try {
    const xdr = await fetchChallenge({ webAuthEndpoint: anchor.webAuthEndpoint, account: s.address, homeDomain: anchor.homeDomain });
    const checked = checkChallenge(xdr, expectation(anchor, s.address));
    return {
      status: "needs_partner_signin",
      receive,
      hash: checked.hash,
      address: s.address,
      challenge: checked.xdr,
      expiresAt: checked.expiresAt * 1000,
    };
  } catch (err) {
    unreachable(err);
  }
}

/** The partner session, if it is for this wallet and still valid. */
function usable(token: string | undefined, account: string) {
  if (!token) return null;
  try {
    return readAnchorToken(token, account).token;
  } catch {
    return null;
  }
}

/**
 * Can this wallet receive this money on the live network? Checked before a
 * top-up starts, so nobody pays naira for money the partner can't deliver.
 */
async function requireCanReceive(account: string, receive: RampCurrency) {
  const cantCheck = () => new ApiFailure("BAD_REQUEST", "We couldn't check your wallet right now. Nothing was sent.", 502);
  const notReady = () =>
    new ApiFailure(
      "SIGNING_UNAVAILABLE",
      `Your wallet isn't set up to receive ${receive === "NGN" ? "naira" : "dollars"} from the naira partner yet. Nothing was sent.`,
      409,
    );
  let res: Response;
  try {
    res = await fetch(`${MAINNET_HORIZON}/accounts/${account}`, { redirect: "error", signal: AbortSignal.timeout(8000) });
  } catch (err) {
    console.error("[ramp:link] horizon", err);
    throw cantCheck();
  }
  // 404: the wallet doesn't exist on the live network. 400: not a real address (mock sign-in).
  if (res.status === 404 || res.status === 400) throw notReady();
  if (!res.ok) throw cantCheck();
  const body = (await res.json().catch(() => null)) as { balances?: Array<{ asset_code?: string; asset_issuer?: string }> } | null;
  const { code, issuer } = LINK[receive].asset;
  if (!body?.balances?.some((b) => b.asset_code === code && b.asset_issuer === issuer)) throw notReady();
}

export const linkRamp: RampProvider = {
  id: "link",
  live: true,
  identityCheck: "partner_page",
  receives: ["NGN", "USDC"],

  async limits(receive) {
    const { info } = await linkAnchor(receive);
    return { currency: receive, topUp: info.deposit, cashOut: info.withdraw };
  },

  verifyIdentity() {
    throw new ApiFailure("BAD_REQUEST", "The partner checks your identity on its own page. Wura doesn't ask for your NIN.");
  },

  async finishSignIn(s, input) {
    const { anchor } = await linkAnchor(input.receive);
    let signedXdr: string;
    try {
      // The challenge comes back from the browser, so it is checked again from
      // scratch: partner-signed, for this wallet, sign-in data only, current.
      const checked = checkChallenge(String(input.challenge ?? ""), expectation(anchor, s.address));
      signedXdr = signChallenge({
        checked,
        networkPassphrase: anchor.networkPassphrase,
        account: s.address,
        signatureHex: String(input.signature ?? ""),
      });
    } catch (err) {
      if (!(err instanceof ChallengeError)) throw err;
      console.error("[ramp:link]", err);
      throw new ApiFailure("NOT_APPROVED", "That sign-in couldn't be confirmed, so nothing was started. Please try again.", 403);
    }
    try {
      const t = await exchangeChallenge({ webAuthEndpoint: anchor.webAuthEndpoint, signedXdr, account: s.address });
      return { token: t.token, expiresAt: t.expiresAt * 1000 };
    } catch (err) {
      unreachable(err);
    }
  },

  async startTopUp(s, { amount, receive, partnerToken }) {
    await requireCanReceive(s.address, receive);
    const token = usable(partnerToken, s.address);
    if (!token) return signInStart(s, receive);
    const { anchor } = await linkAnchor(receive);
    try {
      const page = await startInteractive("deposit", {
        transferServer: anchor.transferServer,
        homeDomain: anchor.homeDomain,
        token,
        assetCode: LINK[receive].asset.code,
        assetIssuer: LINK[receive].asset.issuer,
        account: s.address,
        amount,
      });
      return { id: page.id, amount, currency: receive, status: "open_partner_page", mock: false, url: page.url };
    } catch (err) {
      unreachable(err);
    }
  },

  async topUpStatus(s, { id, receive, partnerToken }) {
    const token = usable(partnerToken, s.address);
    if (!token) return signInStart(s, receive);
    const { anchor } = await linkAnchor(receive);
    try {
      const t = await getTransfer({ transferServer: anchor.transferServer, token, id });
      if (t.kind !== "deposit") throw new Error("not a top-up");
      return { id, state: t.state, currency: receive, received: t.amountOut, fee: t.fee, txRef: t.stellarTxId };
    } catch (err) {
      unreachable(err);
    }
  },

  async previewCashOut() {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Naira cash-outs through the partner aren't switched on yet. Nothing was sent.", 409);
  },

  /** Neither service publishes quotes (no SEP-38); the rate is shown on the partner's page. */
  async quote() {
    return null;
  },
};
