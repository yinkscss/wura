import dns from "node:dns";
import https from "node:https";
import net from "node:net";

/**
 * Fetches a page for site connect without letting a site point us at our own
 * network. Server-side fetching of user-supplied URLs is an SSRF risk, so:
 *   - https only, port 443 only, no credentials in the URL.
 *   - Every address the host resolves to must be public. This is checked again
 *     at connect time (in the socket's own lookup), so a host can't pass the
 *     check and then rebind to 127.0.0.1.
 *   - Redirects are followed by hand, each one checked the same way.
 *   - Responses are capped in size and time, and sent uncompressed so a small
 *     download can't expand into a huge one.
 *
 * No "server-only" import on purpose: tests load this file directly.
 */

export class FetchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FetchRefused";
  }
}

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, p) => n * 256 + parseInt(p, 10), 0);
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function v4Blocked(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    return n >= start && n < start + size;
  });
}

/** Expands an IPv6 address to eight 16-bit groups. Returns null if it isn't valid. */
function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    if (!net.isIPv4(tail[1])) return null;
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...rest].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for any address we must never fetch from: private, loopback, link-local, metadata, multicast, unparseable. */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return v4Blocked(ip);
  if (!net.isIPv6(ip)) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (allZero(0, 8)) return true; // ::
  if (allZero(0, 7) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: judge by the IPv4 inside.
  const embedded = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (allZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return v4Blocked(embedded);
  // NAT64 (64:ff9b::/96)
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return v4Blocked(embedded);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2002) return v4Blocked(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  return false;
}

/** Throws FetchRefused unless the URL is a plain https URL to a named host. Does not resolve DNS. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchRefused("That isn't a valid link.");
  }
  if (url.protocol !== "https:") throw new FetchRefused("Only https links are allowed.");
  if (url.username || url.password) throw new FetchRefused("Links with a username or password aren't allowed.");
  if (url.port && url.port !== "443") throw new FetchRefused("Only the standard https port is allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0) throw new FetchRefused("Links to a raw IP address aren't allowed.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("That address is private.");
  }
  return url;
}

type LookupFn = typeof dns.lookup;

/**
 * A dns.lookup replacement for the socket: resolves, then refuses if any
 * returned address is blocked. Runs at connect time, so it can't be raced.
 */
export function guardedLookup(inner: LookupFn = dns.lookup): LookupFn {
  return ((hostname: string, options: unknown, callback: (...a: unknown[]) => void) => {
    const cb = typeof options === "function" ? (options as (...a: unknown[]) => void) : callback;
    const opts = typeof options === "object" && options ? { ...(options as object) } : {};
    (inner as (h: string, o: object, c: (...a: unknown[]) => void) => void)(hostname, { ...opts, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = addrs as Array<{ address: string; family: number }>;
      if (!list.length || list.some((a) => isBlockedIp(a.address))) {
        return cb(new FetchRefused("That site resolves to a private address."));
      }
      if ((opts as { all?: boolean }).all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  }) as unknown as LookupFn;
}

export type SafeFetchOptions = {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  accept?: RegExp;
  lookup?: LookupFn;
  /** For tests: replaces the network request. */
  request?: typeof https.request;
};

export type SafeFetchResult = { url: string; status: number; contentType: string; body: string; truncated: boolean };

const DEFAULT_ACCEPT = /^(text\/|application\/(json|javascript|x-javascript|ecmascript|xhtml\+xml))/i;

function once(url: URL, o: Required<Omit<SafeFetchOptions, "request" | "lookup">> & { lookup: LookupFn; request: typeof https.request }) {
  return new Promise<SafeFetchResult & { location?: string }>((resolve, reject) => {
    const req = o.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup(o.lookup) as never,
        headers: { "user-agent": "WuraSiteReader/1.0", accept: "text/html,application/javascript,application/json,*/*;q=0.5", "accept-encoding": "identity" },
        timeout: o.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ url: url.toString(), status, contentType, body: "", truncated: false, location: String(res.headers.location) });
        }
        if (!o.accept.test(contentType)) {
          res.destroy();
          return reject(new FetchRefused("That link isn't a web page or script."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            truncated = true;
            chunks.push(c.subarray(0, c.length - (size - o.maxBytes)));
            res.destroy();
            return;
          }
          chunks.push(c);
        });
        const done = () => resolve({ url: url.toString(), status, contentType, body: Buffer.concat(chunks).toString("utf8"), truncated });
        res.on("end", done);
        res.on("close", done);
        res.on("error", (e) => (truncated ? done() : reject(e)));
      },
    );
    req.on("timeout", () => req.destroy(new FetchRefused("The site took too long to answer.")));
    req.on("error", reject);
    req.end();
  });
}

/** GET a public https page as text. Throws FetchRefused for anything unsafe. */
export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const o = {
    maxBytes: opts.maxBytes ?? 1_500_000,
    timeoutMs: opts.timeoutMs ?? 8_000,
    maxRedirects: opts.maxRedirects ?? 3,
    accept: opts.accept ?? DEFAULT_ACCEPT,
    lookup: opts.lookup ?? dns.lookup,
    request: opts.request ?? https.request,
  };
  let url = assertSafeUrl(raw);
  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    const res = await once(url, o);
    if (!res.location) return res;
    url = assertSafeUrl(new URL(res.location, url).toString());
  }
  throw new FetchRefused("That site redirected too many times.");
}
