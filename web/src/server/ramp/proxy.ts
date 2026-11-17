import { ProxyAgent, fetch as undiciFetch } from "undici";

/**
 * Fetch for calls to the naira partner (LINK).
 *
 * Off by default: with PARTNER_PROXY_URL unset this is the plain global fetch.
 * Turn it on only if the partner can allow a fixed IP address but not
 * Vercel's changing ones. Set PARTNER_PROXY_URL (Production only) to the
 * fixed-IP forward proxy, e.g. http://user:pass@host:port.
 *
 * The proxy must be a CONNECT proxy, so TLS runs from Wura to the partner and
 * the proxy only sees the partner's host name, never the sign-in token or the
 * payment memo. A relay that terminates TLS is not acceptable.
 *
 * Fails closed: a set but unusable URL throws on every call. It never falls
 * back to a direct request, which would hide that the proxy is broken.
 *
 * No app imports on purpose, so `node --test` can load it.
 */

export class PartnerProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartnerProxyError";
  }
}

/** Returns the proxy URL to use, or null when none is configured. Throws on a bad value. */
export function parseProxyUrl(raw: string | undefined): URL | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new PartnerProxyError("PARTNER_PROXY_URL is not a valid URL.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new PartnerProxyError("PARTNER_PROXY_URL must start with http:// or https://.");
  }
  if (!u.hostname) throw new PartnerProxyError("PARTNER_PROXY_URL has no host.");
  return u;
}

let cached: { key: string; agent: ProxyAgent } | null = null;

function agentFor(u: URL): ProxyAgent {
  const key = u.href;
  if (cached?.key === key) return cached.agent;
  // Credentials go in the Proxy-Authorization header; keep them out of the URI.
  const token =
    u.username || u.password
      ? `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`
      : undefined;
  const bare = new URL(u.href);
  bare.username = "";
  bare.password = "";
  const agent = new ProxyAgent({ uri: bare.href, token });
  cached = { key, agent };
  return agent;
}

/**
 * Builds the fetch for the given environment. Exported for tests; the app uses
 * `partnerFetch` below.
 */
export function makePartnerFetch(env: Record<string, string | undefined>, impl?: typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const proxy = parseProxyUrl(env.PARTNER_PROXY_URL);
    // Read the global at call time, so a test or runtime that swaps it is honoured.
    if (!proxy) return (impl ?? globalThis.fetch)(input, init);
    // undici's own fetch is the one that understands its own dispatcher.
    return undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...(init as object), dispatcher: agentFor(proxy) } as Parameters<typeof undiciFetch>[1],
    ) as unknown as Promise<Response>;
  }) as typeof fetch;
}

/** True when partner calls are routed through the proxy. Throws on a bad value. */
export function partnerProxyOn(env: Record<string, string | undefined> = process.env): boolean {
  return parseProxyUrl(env.PARTNER_PROXY_URL) !== null;
}

export const partnerFetch: typeof fetch = makePartnerFetch(process.env);
