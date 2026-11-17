import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { makePartnerFetch, parseProxyUrl, partnerProxyOn, PartnerProxyError } from "./proxy";

test("off by default: unset or blank uses the plain fetch", async () => {
  assert.equal(parseProxyUrl(undefined), null);
  assert.equal(parseProxyUrl("   "), null);
  assert.equal(partnerProxyOn({}), false);
  let called = "";
  const impl = (async (input: unknown) => {
    called = String(input);
    return new Response("ok");
  }) as typeof fetch;
  const f = makePartnerFetch({}, impl);
  const res = await f("https://ngnc.online/info");
  assert.equal(await res.text(), "ok");
  assert.equal(called, "https://ngnc.online/info");
});

test("a bad value fails closed and never falls back to a direct call", async () => {
  for (const bad of ["not a url", "socks5://1.2.3.4:1080", "ftp://x.test"]) {
    assert.throws(() => parseProxyUrl(bad), PartnerProxyError);
  }
  let direct = false;
  const impl = (async () => {
    direct = true;
    return new Response("ok");
  }) as typeof fetch;
  const f = makePartnerFetch({ PARTNER_PROXY_URL: "socks5://1.2.3.4:1080" }, impl);
  await assert.rejects(async () => f("https://ngnc.online/info"), PartnerProxyError);
  assert.equal(direct, false);
});

test("errors never echo the proxy credentials", () => {
  try {
    parseProxyUrl("socks5://user:hunter2@1.2.3.4:1080");
    assert.fail("should throw");
  } catch (e) {
    assert.ok(e instanceof PartnerProxyError);
    assert.ok(!String((e as Error).message).includes("hunter2"));
  }
});

test("when set, the call goes to the proxy with the proxy login, not direct", async () => {
  const seen: { url?: string; auth?: string; host?: string } = {};
  const server = http.createServer((req, res) => {
    seen.url = req.url;
    seen.auth = req.headers["proxy-authorization"] as string | undefined;
    seen.host = req.headers.host;
    res.end("via proxy");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    let direct = false;
    const impl = (async () => {
      direct = true;
      return new Response("direct");
    }) as typeof fetch;
    const f = makePartnerFetch({ PARTNER_PROXY_URL: `http://user:p%40ss@127.0.0.1:${port}` }, impl);
    // Plain http target keeps the test offline; https uses CONNECT (next test).
    const res = await f("http://anchor.test/info");
    assert.equal(await res.text(), "via proxy");
    assert.equal(direct, false);
    assert.equal(seen.url, "http://anchor.test/info");
    assert.equal(seen.auth, `Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});

test("https goes through a CONNECT tunnel, so the proxy sees only the host", async () => {
  const seen: { target?: string; auth?: string } = {};
  const server = http.createServer();
  server.on("connect", (req, socket) => {
    seen.target = req.url;
    seen.auth = req.headers["proxy-authorization"] as string | undefined;
    socket.destroy(); // We only need to see the tunnel request.
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const f = makePartnerFetch({ PARTNER_PROXY_URL: `http://u:p@127.0.0.1:${port}` });
    await assert.rejects(() => f("https://ngnc.online/info", { signal: AbortSignal.timeout(3000) }));
    assert.equal(seen.target, "ngnc.online:443");
    assert.equal(seen.auth, `Basic ${Buffer.from("u:p").toString("base64")}`);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
