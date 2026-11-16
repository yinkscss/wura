import assert from "node:assert/strict";
import { test } from "node:test";
import { FetchRefused, assertSafeUrl, guardedLookup, isBlockedIp, safeFetchText } from "./safe-fetch";

test("private, loopback, link-local and metadata addresses are blocked", () => {
  for (const ip of [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1",
    "not-an-ip",
  ]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
});

test("public addresses are allowed", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "104.18.2.3", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedIp(ip), false, ip);
  }
});

test("assertSafeUrl allows plain https and refuses everything else", () => {
  assert.equal(assertSafeUrl("https://shop.example.org/buy?x=1").hostname, "shop.example.org");
  for (const bad of [
    "http://shop.example.org", "ftp://x.org", "file:///etc/passwd", "javascript:alert(1)",
    "https://user:pw@shop.example.org", "https://shop.example.org:8443", "https://127.0.0.1",
    "https://[::1]/", "https://169.254.169.254/latest/meta-data", "https://localhost", "https://db.internal",
    "https://printer.local", "https://2130706433", "not a url",
  ]) {
    assert.throws(() => assertSafeUrl(bad), FetchRefused, bad);
  }
});

type Cb = (err: Error | null, a?: unknown, f?: number) => void;
const fakeDns = (addresses: string[]) =>
  ((_h: string, _o: unknown, cb: Cb) => cb(null, addresses.map((a) => ({ address: a, family: a.includes(":") ? 6 : 4 })))) as never;

function resolveWith(addresses: string[]) {
  return new Promise<{ err: Error | null; res?: unknown }>((resolve) => {
    (guardedLookup(fakeDns(addresses)) as unknown as (h: string, o: object, cb: Cb) => void)("x.org", { all: true }, (err, res) =>
      resolve({ err, res }),
    );
  });
}

test("the connect-time lookup refuses a host that resolves to a private address, even mixed with public ones", async () => {
  assert.ok((await resolveWith(["127.0.0.1"])).err instanceof FetchRefused);
  assert.ok((await resolveWith(["8.8.8.8", "10.0.0.5"])).err instanceof FetchRefused);
  assert.equal((await resolveWith(["8.8.8.8"])).err, null);
});

// A fake https.request so redirects and limits can be tested without a network.
type Reply = { status: number; headers?: Record<string, string>; chunks?: string[] };
function fakeRequest(plan: Record<string, Reply>, seen: string[] = []) {
  return ((url: URL, _opts: unknown, onRes: (res: unknown) => void) => {
    const listeners: Record<string, (...a: unknown[]) => void> = {};
    const reply = plan[url.toString()] ?? { status: 404, headers: { "content-type": "text/plain" } };
    seen.push(url.toString());
    return {
      on: (e: string, f: (...a: unknown[]) => void) => (listeners[e] = f),
      destroy: () => {},
      end: () => {
        const res = {
          statusCode: reply.status,
          headers: reply.headers ?? { "content-type": "text/html" },
          resume: () => {},
          destroy: () => {},
          handlers: {} as Record<string, (...a: unknown[]) => void>,
          on(e: string, f: (...a: unknown[]) => void) {
            this.handlers[e] = f;
            return this;
          },
        };
        onRes(res);
        for (const c of reply.chunks ?? []) res.handlers.data?.(Buffer.from(c));
        res.handlers.end?.();
      },
    };
  }) as never;
}

test("redirects are followed one by one, and a redirect to a private host is refused", async () => {
  const seen: string[] = [];
  const ok = await safeFetchText("https://a.example.org/", {
    request: fakeRequest({
      "https://a.example.org/": { status: 302, headers: { location: "https://b.example.org/x" } },
      "https://b.example.org/x": { status: 200, chunks: ["hello"] },
    }, seen),
  });
  assert.equal(ok.body, "hello");
  assert.deepEqual(seen, ["https://a.example.org/", "https://b.example.org/x"]);

  await assert.rejects(
    safeFetchText("https://a.example.org/", {
      request: fakeRequest({ "https://a.example.org/": { status: 302, headers: { location: "https://169.254.169.254/latest" } } }),
    }),
    FetchRefused,
  );
  await assert.rejects(
    safeFetchText("https://a.example.org/", {
      request: fakeRequest({ "https://a.example.org/": { status: 302, headers: { location: "http://b.example.org/" } } }),
    }),
    FetchRefused,
  );
});

test("a redirect loop stops after the limit", async () => {
  await assert.rejects(
    safeFetchText("https://a.example.org/", {
      maxRedirects: 2,
      request: fakeRequest({ "https://a.example.org/": { status: 302, headers: { location: "https://a.example.org/" } } }),
    }),
    /too many times/,
  );
});

test("the response is capped and non-text content is refused", async () => {
  const big = await safeFetchText("https://a.example.org/", {
    maxBytes: 10,
    request: fakeRequest({ "https://a.example.org/": { status: 200, chunks: ["0123456789", "overflow"] } }),
  });
  assert.equal(big.body, "0123456789");
  assert.equal(big.truncated, true);

  await assert.rejects(
    safeFetchText("https://a.example.org/", {
      request: fakeRequest({ "https://a.example.org/": { status: 200, headers: { "content-type": "application/octet-stream" } } }),
    }),
    /isn't a web page/,
  );
});
