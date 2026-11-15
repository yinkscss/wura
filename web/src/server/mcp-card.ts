import "server-only";

/**
 * The send-preview card shown inside Claude (MCP Apps). Plain HTML + the
 * ext-apps browser bundle, served from our own domain. Follows the host's
 * light/dark theme. States: ready (with countdown), approving, sent,
 * cancelled, expired, error.
 *
 * `demo` renders sample data without a host, for local design checks.
 *
 * Approve calls the app-only `approve_send` tool with the one-time code from
 * the result's `_meta` (which the model never sees). When in-chat approval
 * isn't possible (chat approvals off, preview expired, a refusal), the card
 * offers "Open in Wura" instead: the /approve page rebuilds and confirms there.
 */

export type CardPreview = {
  intentId: string;
  to: string;
  toAddress: string;
  amount: string; // "10.00"
  fee: string; // "0.00"
  total: string;
  network: "testnet" | "mock";
  dailyLeftAfter: string;
  perPaymentCap: string;
  expiresAt: number;
  /** False when the agent key isn't set up: the card then links to Wura instead. */
  inChat: boolean;
  /** The /approve/<id> page for this preview. */
  approveUrl: string;
};

export function sendPreviewCardHtml(baseUrl: string, opts: { demo?: CardPreview } = {}) {
  const demo = opts.demo ? JSON.stringify(opts.demo) : "null";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  :root{--blue:#08318D;--blue-2:#092D8E;--pink:#FD91CC;--pink-deep:#E0569F;--bg:#fff;--surface:#F4F7FD;--line:rgba(8,49,141,.10);--text:#08318D;--muted:#5B6B95;--soft:#8A97B8;--btn:#08318D;--btn-text:#fff}
  :root[data-theme="dark"]{--bg:#0E1630;--surface:#16204A;--line:rgba(255,255,255,.09);--text:#EEF2FF;--muted:#A9B4D6;--soft:#7D89B0;--btn:#FD91CC;--btn-text:#08318D}
  *{box-sizing:border-box}
  html,body{margin:0;background:transparent}
  body{font-family:"Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased;padding:2px}
  .card{background:var(--bg);border:1px solid var(--line);border-radius:20px;padding:18px 18px 16px}
  .top{display:flex;align-items:center;gap:10px}
  .mark{width:26px;height:26px;border-radius:8px;background:var(--blue);color:#fff;display:grid;place-items:center;font-size:13px}
  :root[data-theme="dark"] .mark{background:#fff;color:var(--blue)}
  .brand{font-weight:700;font-size:14px;letter-spacing:-.01em}
  .chip{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;background:var(--surface);color:var(--muted)}
  .lbl{margin-top:16px;font-size:12.5px;color:var(--muted)}
  .amt{display:flex;align-items:baseline;gap:8px;margin-top:2px}
  .amt b{font-size:36px;line-height:1.05;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
  .amt span{font-size:15px;font-weight:700;color:var(--pink-deep)}
  :root[data-theme="dark"] .amt span{color:var(--pink)}
  .to{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 12px;border-radius:14px;background:var(--surface)}
  .av{width:32px;height:32px;border-radius:50%;background:var(--pink);color:var(--blue);display:grid;place-items:center;font-weight:800;font-size:14px;flex:none}
  .who{min-width:0}.who b{display:block;font-size:14.5px;font-weight:700}
  .who code{font:500 11.5px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
  dl{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:14px 2px 0}
  dt{font-size:11.5px;color:var(--soft)}dd{margin:2px 0 0;font-size:13.5px;font-weight:600;font-variant-numeric:tabular-nums}
  .act{margin-top:16px;display:flex;flex-direction:column;gap:8px}
  .go{appearance:none;border:0;border-radius:14px;padding:14px 16px;font-family:inherit;font-weight:700;font-size:15px;line-height:1;background:var(--btn);color:var(--btn-text);cursor:pointer;transition:transform .08s ease,opacity .15s}
  .go:active{transform:scale(.99)}.go:disabled{opacity:.45;cursor:default}
  .row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--soft)}
  .link{appearance:none;border:0;background:none;padding:4px 0;font-family:inherit;font-weight:600;font-size:13px;line-height:1;color:var(--muted);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
  .state{display:none;align-items:center;gap:12px;margin-top:16px;padding:12px 14px;border-radius:14px;background:var(--surface);font-size:13.5px;line-height:1.4}
  .state.on{display:flex}
  .ic{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;flex:none;font-weight:800;font-size:14px}
  .ok .ic{background:var(--pink);color:var(--blue)}.bad .ic{background:rgba(224,86,159,.15);color:var(--pink-deep)}.mute .ic{background:var(--line);color:var(--muted)}
  .state small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
  .spin{width:16px;height:16px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;vertical-align:-3px;animation:s .7s linear infinite;margin-right:8px}
  @keyframes s{to{transform:rotate(1turn)}}
  .hide{display:none!important}
  .note{margin-top:14px;font-size:12.5px;line-height:1.45;color:var(--muted)}
  .go.alt{margin-top:12px;width:100%;background:var(--surface);color:var(--text)}
  .skel{height:150px;border-radius:14px;background:var(--surface);margin-top:14px}
</style></head>
<body>
<div class="card">
  <div class="top"><div class="mark">✦</div><div class="brand">Wura</div><div class="chip" id="net">Send preview</div></div>
  <div id="loading" class="skel"></div>
  <div id="body" class="hide">
    <div class="lbl">You’re sending</div>
    <div class="amt"><b id="amt"></b><span>USDC</span></div>
    <div class="to"><div class="av" id="av"></div><div class="who"><b id="to"></b><code id="addr"></code></div></div>
    <dl>
      <div><dt>Network fee</dt><dd id="fee"></dd></div>
      <div><dt>Total</dt><dd id="total"></dd></div>
      <div><dt>Left today after this</dt><dd id="left"></dd></div>
      <div><dt>Per-payment cap</dt><dd id="cap"></dd></div>
    </dl>
    <div class="act" id="act">
      <button class="go" id="approve">Approve</button>
      <div class="row"><span id="timer">Nothing moves until you approve.</span><button class="link" id="cancel">Cancel</button></div>
    </div>
    <div class="note hide" id="note"></div>
    <div class="state ok" id="s-ok"><div class="ic">✓</div><div><b id="ok-t"></b><small id="ok-s"></small></div></div>
    <div class="state mute" id="s-mute"><div class="ic">–</div><div><b id="mute-t"></b><small id="mute-s"></small></div></div>
    <div class="state bad" id="s-bad"><div class="ic">!</div><div><b id="bad-t"></b><small id="bad-s"></small></div></div>
    <button class="go alt hide" id="open">Open in Wura</button>
  </div>
</div>
<script type="module">
  const DEMO = ${demo};
  const $ = (id) => document.getElementById(id);
  let p = null, code = null, timer = null, done = false;
  const short = (a) => a ? a.slice(0, 4) + "…" + a.slice(-4) : "";
  function theme(t){ document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"; }
  function show(kind, title, sub, offerOpen){
    done = true; clearInterval(timer); $("act").classList.add("hide"); $("note").classList.add("hide");
    $("s-" + kind).classList.add("on"); $(kind + "-t").textContent = title; $(kind + "-s").textContent = sub || "";
    if (offerOpen && p && p.approveUrl) $("open").classList.remove("hide");
  }
  function render(data){
    p = data;
    $("loading").classList.add("hide"); $("body").classList.remove("hide");
    $("net").textContent = data.network === "testnet" ? "Stellar testnet" : "Example · mock";
    $("amt").textContent = data.amount;
    $("av").textContent = (data.to || "?").trim().charAt(0).toUpperCase();
    $("to").textContent = data.to; $("addr").textContent = short(data.toAddress);
    $("fee").textContent = data.network === "testnet" ? "Paid in test XLM" : data.fee + " USDC";
    $("total").textContent = data.total + " USDC";
    $("left").textContent = data.dailyLeftAfter + " USDC";
    $("cap").textContent = data.perPaymentCap + " USDC";
    $("approve").textContent = data.inChat ? "Approve " + data.amount + " USDC" : "Open in Wura to approve";
    if (!data.inChat) {
      $("note").textContent = "To approve right here, turn on “Approve from chat apps” in Wura → Channels. For now, open it in Wura.";
      $("note").classList.remove("hide");
    }
    clearInterval(timer);
    const tick = () => {
      const s = Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000));
      if (s <= 0) return show("mute", "This preview expired", "Open it in Wura for fresh numbers, or ask Claude again.", true);
      $("timer").textContent = "Expires in " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    };
    tick(); timer = setInterval(tick, 1000);
  }
  $("cancel").onclick = () => show("mute", "Cancelled", "Nothing was sent.");
  async function approve(call){
    if (done || !p) return;
    $("approve").disabled = true; $("approve").innerHTML = '<span class="spin"></span>Approving…';
    try {
      const r = await call();
      const text = (r.content && r.content[0] && r.content[0].text) || "";
      if (r.isError) { show("bad", "Not sent", text, true); return; }
      show("ok", "Sent " + p.amount + " USDC to " + p.to, text);
    } catch (e) {
      $("approve").disabled = false; $("approve").textContent = "Approve " + p.amount + " USDC";
      $("timer").textContent = "That didn’t go through. Try again.";
    }
  }
  if (DEMO) {
    theme(new URLSearchParams(location.search).get("theme") || "light");
    render(DEMO);
    $("open").onclick = () => window.open(DEMO.approveUrl, "_blank");
    $("approve").onclick = () => approve(() => new Promise((r) => setTimeout(() => r({ content: [{ type: "text", text: "Reference MOCK-C4EB3BFCA4F8" }] }), 900)));
  } else {
    const { App } = await import("${baseUrl}/mcp-assets/app");
    const app = new App({ name: "Wura send preview", version: "0.2.0" });
    app.onhostcontextchanged = (ctx) => ctx && ctx.theme && theme(ctx.theme);
    app.ontoolresult = (result) => {
      code = (result._meta && result._meta.approvalCode) || null;
      if (result.structuredContent && result.structuredContent.intentId) render(result.structuredContent);
    };
    const openWura = async () => { try { await app.openLink({ url: p.approveUrl }); } catch (e) {} };
    $("open").onclick = openWura;
    $("approve").onclick = () => p && !p.inChat ? openWura() : approve(() => app.callServerTool({ name: "approve_send", arguments: { intentId: p.intentId, approvalCode: code || "" } }));
    await app.connect();
    const ctx = app.getHostContext(); theme(ctx && ctx.theme);
  }
</script></body></html>`;
}
