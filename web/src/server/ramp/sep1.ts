import { StrKey } from "@stellar/stellar-sdk";
import { partnerFetch } from "./proxy";

/**
 * SEP-1: read an anchor's stellar.toml and check it against values we pinned.
 *
 * This file has no app imports on purpose, so `node --test` can load it
 * directly (see web/tests/ramp).
 *
 * Why pin: the toml tells us which key signs the anchor's sign-in challenges
 * and where its servers are. If the anchor's website were taken over, a new
 * toml could point us at an attacker's key and servers. We refuse any toml
 * whose network or signing key differs from the pinned ones, and any endpoint
 * that is not HTTPS on the anchor's own domain.
 */

export type AnchorPin = {
  /** Domain that serves /.well-known/stellar.toml, e.g. "ngnc.online". */
  homeDomain: string;
  networkPassphrase: string;
  /** The anchor's SIGNING_KEY as we recorded it. A change must be reviewed by a person. */
  signingKey: string;
};

export type AnchorEndpoints = {
  homeDomain: string;
  networkPassphrase: string;
  signingKey: string;
  /** SEP-10 endpoint. */
  webAuthEndpoint: string;
  /** Host of the SEP-10 endpoint; SEP-10 challenges name it. */
  webAuthDomain: string;
  /** SEP-24 base URL, no trailing slash. */
  transferServer: string;
};

export class AnchorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnchorConfigError";
  }
}

const MAX_TOML_BYTES = 100 * 1024;

/**
 * Reads the top-level `KEY = "value"` string pairs of a stellar.toml. Stops at
 * the first table header, which is all SEP-1 needs for endpoints and keys.
 */
export function parseTomlTopLevel(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const m = /^([A-Za-z0-9_]+)\s*=\s*(["'])(.*?)\2\s*(#.*)?$/.exec(line);
    if (m && !(m[1] in out)) out[m[1]] = m[3];
  }
  return out;
}

function onDomain(host: string, homeDomain: string) {
  return host === homeDomain || host.endsWith(`.${homeDomain}`);
}

function endpoint(value: string | undefined, name: string, homeDomain: string): URL {
  if (!value) throw new AnchorConfigError(`The anchor's config has no ${name}.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AnchorConfigError(`The anchor's ${name} is not a valid URL.`);
  }
  if (url.protocol !== "https:") throw new AnchorConfigError(`The anchor's ${name} is not HTTPS.`);
  if (url.username || url.password) throw new AnchorConfigError(`The anchor's ${name} carries credentials.`);
  if (!onDomain(url.hostname, homeDomain)) {
    throw new AnchorConfigError(`The anchor's ${name} is on ${url.hostname}, not on ${homeDomain}.`);
  }
  return url;
}

/** Checks parsed toml fields against the pin. Throws AnchorConfigError on any mismatch. */
export function validateAnchorToml(fields: Record<string, string>, pin: AnchorPin): AnchorEndpoints {
  if (fields.NETWORK_PASSPHRASE !== pin.networkPassphrase) {
    throw new AnchorConfigError("The anchor's config is for a different Stellar network.");
  }
  const key = fields.SIGNING_KEY ?? "";
  if (!StrKey.isValidEd25519PublicKey(key)) {
    throw new AnchorConfigError("The anchor's config has no valid SIGNING_KEY.");
  }
  if (key !== pin.signingKey) {
    throw new AnchorConfigError("The anchor's SIGNING_KEY changed. A person has to review it before we use it.");
  }
  const auth = endpoint(fields.WEB_AUTH_ENDPOINT, "WEB_AUTH_ENDPOINT", pin.homeDomain);
  const transfer = endpoint(fields.TRANSFER_SERVER_SEP0024, "TRANSFER_SERVER_SEP0024", pin.homeDomain);
  return {
    homeDomain: pin.homeDomain,
    networkPassphrase: pin.networkPassphrase,
    signingKey: key,
    webAuthEndpoint: auth.toString(),
    webAuthDomain: auth.host,
    transferServer: transfer.toString().replace(/\/+$/, ""),
  };
}

/** Fetches and validates the anchor's stellar.toml. Never follows redirects. */
export async function loadAnchor(
  pin: AnchorPin,
  opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<AnchorEndpoints> {
  const f = opts.fetch ?? partnerFetch;
  let res: Response;
  try {
    res = await f(`https://${pin.homeDomain}/.well-known/stellar.toml`, {
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      headers: { Accept: "text/plain, application/toml" },
    });
  } catch {
    throw new AnchorConfigError("Couldn't reach the anchor's config file.");
  }
  if (!res.ok) throw new AnchorConfigError(`The anchor's config file answered ${res.status}.`);
  const text = await res.text();
  if (text.length > MAX_TOML_BYTES) throw new AnchorConfigError("The anchor's config file is too large.");
  return validateAnchorToml(parseTomlTopLevel(text), pin);
}
