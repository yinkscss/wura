import { Keypair, StrKey, TransactionBuilder, WebAuth } from "@stellar/stellar-sdk";

/**
 * SEP-10: sign in to an anchor by signing a challenge transaction.
 *
 * This file has no app imports on purpose, so `node --test` can load it
 * directly (see web/tests/ramp).
 *
 * The rule: the user's wallet never signs something just because the anchor
 * sent it. `checkChallenge` proves the XDR is a real SEP-10 challenge for this
 * user from this anchor, and only then returns the hash to sign. A challenge
 * can never move money: its sequence number is 0, so the network rejects it.
 */

export type ChallengeExpectation = {
  /** The user's G… address. */
  account: string;
  /** The anchor's pinned SIGNING_KEY. */
  signingKey: string;
  networkPassphrase: string;
  /** e.g. "ngnc.online" — the challenge's first operation is named "<homeDomain> auth". */
  homeDomain: string;
  /** Host of the SEP-10 endpoint, e.g. "anchor.ngnc.online". */
  webAuthDomain: string;
  /** Longest validity window we accept, in seconds. SEP-10 recommends 15 minutes. */
  maxWindowSec?: number;
};

export type CheckedChallenge = {
  xdr: string;
  /** Transaction hash, hex. This is what the wallet signs. */
  hash: string;
  /** Unix seconds after which the anchor will refuse the signed challenge. */
  expiresAt: number;
};

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeError";
  }
}

/**
 * Validates a SEP-10 challenge. Checks, via the SDK's readChallengeTx:
 *   - the transaction source is the anchor's signing key, sequence number 0
 *   - it is already signed by that key
 *   - the first operation is manage_data "<homeDomain> auth" with the client
 *     account as its source
 *   - every other operation is manage_data sourced by the anchor
 *   - web_auth_domain, when present, matches
 *   - the time window is current
 * and on top of that:
 *   - the client account is exactly the signed-in user's address
 *   - no memo (memos are for shared accounts, which Wura does not use)
 *   - the time window is not longer than we accept
 */
export function checkChallenge(xdr: string, expect: ChallengeExpectation): CheckedChallenge {
  if (!StrKey.isValidEd25519PublicKey(expect.account)) {
    throw new ChallengeError("Only classic G… accounts can sign in to this anchor.");
  }
  let read: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    read = WebAuth.readChallengeTx(
      xdr,
      expect.signingKey,
      expect.networkPassphrase,
      expect.homeDomain,
      expect.webAuthDomain,
    );
  } catch (err) {
    throw new ChallengeError(`The anchor's sign-in challenge was not valid: ${(err as Error).message}`);
  }
  const { tx, clientAccountID, memo } = read;
  if (clientAccountID !== expect.account) {
    throw new ChallengeError("The anchor's sign-in challenge is for a different account.");
  }
  if (memo) throw new ChallengeError("The anchor's sign-in challenge carries a memo we did not ask for.");
  if (tx.operations.some((op) => op.type !== "manageData")) {
    throw new ChallengeError("The anchor's sign-in challenge contains an operation that is not sign-in data.");
  }
  const min = Number(tx.timeBounds?.minTime ?? 0);
  const max = Number(tx.timeBounds?.maxTime ?? 0);
  if (!max || max - min > (expect.maxWindowSec ?? 900)) {
    throw new ChallengeError("The anchor's sign-in challenge stays valid for too long.");
  }
  return { xdr, hash: tx.hash().toString("hex"), expiresAt: max };
}

/** Asks the anchor for a challenge for this account. Returns the raw XDR; check it before use. */
export async function fetchChallenge(input: {
  webAuthEndpoint: string;
  account: string;
  homeDomain: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<string> {
  const f = input.fetch ?? fetch;
  const url = new URL(input.webAuthEndpoint);
  url.searchParams.set("account", input.account);
  url.searchParams.set("home_domain", input.homeDomain);
  let res: Response;
  try {
    res = await f(url, { redirect: "error", signal: AbortSignal.timeout(input.timeoutMs ?? 8000) });
  } catch {
    throw new ChallengeError("Couldn't reach the anchor's sign-in service.");
  }
  if (!res.ok) throw new ChallengeError(`The anchor's sign-in service answered ${res.status}.`);
  const body = (await res.json().catch(() => null)) as { transaction?: unknown } | null;
  if (!body || typeof body.transaction !== "string") {
    throw new ChallengeError("The anchor's sign-in service sent no challenge.");
  }
  return body.transaction;
}

/**
 * Attaches the wallet's signature to a checked challenge. Verifies the
 * signature against the account first, so a wrong signature never reaches the
 * anchor.
 */
export function signChallenge(input: {
  checked: CheckedChallenge;
  networkPassphrase: string;
  account: string;
  /** 64-byte ed25519 signature over the hash, hex (0x prefix allowed). */
  signatureHex: string;
}): string {
  const hex = input.signatureHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) throw new ChallengeError("That is not a wallet signature.");
  const sig = Buffer.from(hex, "hex");
  const kp = Keypair.fromPublicKey(input.account);
  if (!kp.verify(Buffer.from(input.checked.hash, "hex"), sig)) {
    throw new ChallengeError("The signature didn't match your wallet.");
  }
  const tx = TransactionBuilder.fromXDR(input.checked.xdr, input.networkPassphrase);
  tx.addSignature(input.account, sig.toString("base64"));
  return tx.toXDR();
}

export type AnchorToken = { token: string; expiresAt: number };

/** Sends the signed challenge back and returns the anchor's session token. */
export async function exchangeChallenge(input: {
  webAuthEndpoint: string;
  signedXdr: string;
  account: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<AnchorToken> {
  const f = input.fetch ?? fetch;
  let res: Response;
  try {
    res = await f(input.webAuthEndpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(input.timeoutMs ?? 8000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transaction: input.signedXdr }),
    });
  } catch {
    throw new ChallengeError("Couldn't reach the anchor's sign-in service.");
  }
  if (!res.ok) throw new ChallengeError(`The anchor refused the sign-in (${res.status}).`);
  const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== "string") throw new ChallengeError("The anchor sent no session token.");
  return readAnchorToken(body.token, input.account);
}

/**
 * Reads the anchor's JWT without trusting it for anything of ours: it is only
 * ever sent back to the anchor. We check it names this account and has not
 * expired, so a token for someone else is never stored against this user.
 */
export function readAnchorToken(token: string, account: string, nowSec = Math.floor(Date.now() / 1000)): AnchorToken {
  const part = token.split(".")[1];
  let claims: { sub?: unknown; exp?: unknown };
  try {
    claims = JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));
  } catch {
    throw new ChallengeError("The anchor's session token could not be read.");
  }
  // SEP-10 sub is "G…" or "G…:memo".
  const sub = typeof claims.sub === "string" ? claims.sub.split(":")[0] : "";
  if (sub !== account) throw new ChallengeError("The anchor's session token is for a different account.");
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (exp <= nowSec) throw new ChallengeError("The anchor's session token has already expired.");
  return { token, expiresAt: exp };
}
