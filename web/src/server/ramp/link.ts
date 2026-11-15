import "server-only";
import { Networks } from "@stellar/stellar-sdk";
import { ApiFailure } from "../errors";
import type { Session } from "../session";
import { loadAnchor, type AnchorEndpoints, type AnchorPin } from "./sep1";
import { ChallengeError, checkChallenge, exchangeChallenge, fetchChallenge, readAnchorToken, signChallenge } from "./sep10";
import { getInfo, getTransfer, startInteractive, type Sep24Info } from "./sep24";
import type { PartnerSignIn, RampProvider } from "./types";

/**
 * LINK's dollar anchor (anchor.linkio.world) on Stellar MAINNET. The user pays
 * naira by bank transfer on LINK's hosted page and USDC arrives in the wallet;
 * a cash-out is the reverse. It runs SEP-10 sign-in and SEP-24. Its hosted
 * page collects identity and bank details, so Wura never handles them.
 *
 * Why this anchor and not LINK's NGNC one (ngnc.online): NGNC has to be sold
 * for USDC on the open market, and on 13 Nov 2026 that lost about a third on
 * small amounts (docs/money-side.md). This one pays out USDC directly.
 *
 * What is switched on in this version: reading limits, signing in to the
 * partner, starting a top-up and reading its status. Cash-outs are refused
 * until the approval hook exists (docs/money-side.md, "Plan").
 *
 * The anchor is open: no key or agreement is needed to call it, and nothing
 * is agreed with LINK. Customer-facing text says "partner" and does not name
 * it. No real top-up has been completed through it yet.
 */

/** Recorded from https://anchor.linkio.world/.well-known/stellar.toml on 14 Nov 2026. */
export const LINK_PIN: AnchorPin = {
  homeDomain: "anchor.linkio.world",
  networkPassphrase: Networks.PUBLIC,
  signingKey: "GC2MQRX47W5HQOBQPRE6A6ULZIJ5NGDJKDK7NYKNX3HY5OQSOGKOJC7D",
};

/** USDC as issued by Circle on Stellar mainnet. */
export const LINK_ASSET = {
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
};

/** Mainnet Horizon, read-only: used to check the wallet can receive before a top-up starts. */
const MAINNET_HORIZON = "https://horizon.stellar.org";

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; anchor: AnchorEndpoints; info: Sep24Info } | null = null;

function unreachable(err: unknown): never {
  if (err instanceof ApiFailure) throw err;
  // The reason is for us, not for the customer.
  console.error("[ramp:link]", err);
  throw new ApiFailure("BAD_REQUEST", "The naira partner can't be reached right now. Nothing was sent.", 502);
}

/** The anchor's validated endpoints and published limits, cached for five minutes. */
export async function linkAnchor() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const anchor = await loadAnchor(LINK_PIN);
    const info = await getInfo(anchor.transferServer, LINK_ASSET.code);
    cached = { at: Date.now(), anchor, info };
    return cached;
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
async function signInStart(s: Session): Promise<PartnerSignIn> {
  const { anchor } = await linkAnchor();
  try {
    const xdr = await fetchChallenge({ webAuthEndpoint: anchor.webAuthEndpoint, account: s.address, homeDomain: anchor.homeDomain });
    const checked = checkChallenge(xdr, expectation(anchor, s.address));
    return {
      status: "needs_partner_signin",
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
 * Can this wallet receive dollars on the live network? Checked before a
 * top-up starts, so nobody pays naira for dollars the partner can't deliver.
 */
async function requireCanReceive(account: string) {
  const cantCheck = () => new ApiFailure("BAD_REQUEST", "We couldn't check your wallet right now. Nothing was sent.", 502);
  const notReady = () =>
    new ApiFailure("SIGNING_UNAVAILABLE", "Your wallet isn't set up to receive dollars from the naira partner yet. Nothing was sent.", 409);
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
  const ok = body?.balances?.some((b) => b.asset_code === LINK_ASSET.code && b.asset_issuer === LINK_ASSET.issuer);
  if (!ok) throw notReady();
}

export const linkRamp: RampProvider = {
  id: "link",
  live: true,
  identityCheck: "partner_page",

  async limits() {
    const { info } = await linkAnchor();
    return { currency: "USDC", topUp: info.deposit, cashOut: info.withdraw };
  },

  verifyIdentity() {
    throw new ApiFailure("BAD_REQUEST", "The partner checks your identity on its own page. Wura doesn't ask for your NIN.");
  },

  async finishSignIn(s, input) {
    const { anchor } = await linkAnchor();
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

  async startTopUp(s, { amount, partnerToken }) {
    await requireCanReceive(s.address);
    const token = usable(partnerToken, s.address);
    if (!token) return signInStart(s);
    const { anchor } = await linkAnchor();
    try {
      const page = await startInteractive("deposit", {
        transferServer: anchor.transferServer,
        homeDomain: anchor.homeDomain,
        token,
        assetCode: LINK_ASSET.code,
        assetIssuer: LINK_ASSET.issuer,
        account: s.address,
        amount,
      });
      return { id: page.id, amount, currency: "USDC", status: "open_partner_page", mock: false, url: page.url };
    } catch (err) {
      unreachable(err);
    }
  },

  async topUpStatus(s, { id, partnerToken }) {
    const token = usable(partnerToken, s.address);
    if (!token) return signInStart(s);
    const { anchor } = await linkAnchor();
    try {
      const t = await getTransfer({ transferServer: anchor.transferServer, token, id });
      if (t.kind !== "deposit") throw new Error("not a top-up");
      return { id, state: t.state, currency: "USDC", received: t.amountOut, fee: t.fee, txRef: t.stellarTxId };
    } catch (err) {
      unreachable(err);
    }
  },

  async previewCashOut() {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Naira cash-outs through the partner aren't switched on yet. Nothing was sent.", 409);
  },

  /** The anchor publishes no quote service (no SEP-38); the rate is shown on its page. */
  async quote() {
    return null;
  },
};
