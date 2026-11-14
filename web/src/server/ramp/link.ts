import "server-only";
import { Networks } from "@stellar/stellar-sdk";
import { ApiFailure } from "../errors";
import { loadAnchor, type AnchorEndpoints, type AnchorPin } from "./sep1";
import { getInfo, type Sep24Info } from "./sep24";
import type { RampProvider } from "./types";

/**
 * LINK (ngnc.online), a naira anchor on Stellar MAINNET. It issues NGNC and
 * runs SEP-10 sign-in and SEP-24 hosted deposit and withdrawal. Its hosted
 * page collects identity and bank details, so Wura never handles them.
 *
 * What is switched on in this version: reading LINK's published limits.
 * Top-ups and cash-outs are refused until the sign-in routes, the NGNC
 * trustline and the approval hook exist (docs/money-side.md, "Plan").
 *
 * Nothing is agreed with LINK. Customer-facing text says "partner" and does
 * not name it.
 */

/** Recorded from https://ngnc.online/.well-known/stellar.toml on 13 Nov 2026. */
export const LINK_PIN: AnchorPin = {
  homeDomain: "ngnc.online",
  networkPassphrase: Networks.PUBLIC,
  signingKey: "GCQLPBWOQ5PAJYEEQBE7GDSY7X3LCYKFEBKOCNF3OUA6F74ORK74HVSQ",
};

export const LINK_ASSET = {
  code: "NGNC",
  issuer: "GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6",
};

const CACHE_MS = 5 * 60 * 1000;
let cached: { at: number; anchor: AnchorEndpoints; info: Sep24Info } | null = null;

/** The anchor's validated endpoints and published limits, cached for five minutes. */
export async function linkAnchor() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached;
  try {
    const anchor = await loadAnchor(LINK_PIN);
    const info = await getInfo(anchor.transferServer, LINK_ASSET.code);
    cached = { at: Date.now(), anchor, info };
    return cached;
  } catch (err) {
    // The reason is for us, not for the customer.
    console.error("[ramp:link]", err);
    throw new ApiFailure("BAD_REQUEST", "The naira partner can't be reached right now. Nothing was sent.", 502);
  }
}

function notSwitchedOn(what: string): never {
  throw new ApiFailure(
    "SIGNING_UNAVAILABLE",
    `Naira ${what} through the partner aren't switched on yet. Nothing was sent.`,
    409,
  );
}

export const linkRamp: RampProvider = {
  id: "link",
  live: true,
  identityCheck: "partner_page",

  async limits() {
    const { info } = await linkAnchor();
    return { topUp: info.deposit, cashOut: info.withdraw };
  },

  verifyIdentity() {
    throw new ApiFailure("BAD_REQUEST", "The partner checks your identity on its own page. Wura doesn't ask for your NIN.");
  },

  async startTopUp() {
    return notSwitchedOn("top-ups");
  },

  async previewCashOut() {
    return notSwitchedOn("cash-outs");
  },

  /** LINK publishes no quote service (no SEP-38), so routing gets nothing from it. */
  async quote() {
    return null;
  },
};
