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
  network: "testnet" | "mainnet" | "mock";
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
<meta name="color-scheme" content="light dark">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  /* color-scheme must match the host's, or the browser paints the iframe white behind the rounded card. */
  :root{color-scheme:light;--blue:#08318D;--pink:#FD91CC;--pink-deep:#D9478F;--bg:#fff;--surface:#F3F6FC;--line:rgba(8,49,141,.12);--text:#0B2466;--muted:#5B6B95;--soft:#8A97B8;--btn:#08318D;--btn-text:#fff;--ok:#FD91CC}
  :root[data-theme="dark"]{color-scheme:dark;--bg:#111A36;--surface:#1A2550;--line:rgba(255,255,255,.08);--text:#EEF2FF;--muted:#A9B4D6;--soft:#7D89B0;--btn:#FD91CC;--btn-text:#08318D;--pink-deep:#FD91CC}
  *{box-sizing:border-box}
  html,body{margin:0;background:transparent}
  body{font:14px/1.35 "Plus Jakarta Sans",ui-sans-serif,system-ui,-apple-system,sans-serif;color:var(--text);-webkit-font-smoothing:antialiased}
  .card{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:14px 16px;max-width:520px}
  .top{display:flex;align-items:center;gap:7px;font-size:12.5px;color:var(--muted)}
  .mark{width:18px;height:18px;border-radius:5px;background:var(--blue);color:#fff;display:grid;place-items:center;font-size:10px}
  :root[data-theme="dark"] .mark{background:#fff;color:var(--blue)}
  .brand{font-weight:700;color:var(--text)}
  .chip{margin-left:auto;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:999px;background:var(--surface);color:var(--muted)}
  .main{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:12px}
  .amt{display:flex;align-items:baseline;gap:5px;white-space:nowrap}
  .amt b{font-size:28px;line-height:1;font-weight:800;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
  .amt span{font-size:13px;font-weight:700;color:var(--pink-deep)}
  .to{display:flex;align-items:center;gap:9px;min-width:0;padding:6px 12px 6px 6px;border-radius:999px;background:var(--surface)}
  .av{width:26px;height:26px;border-radius:50%;background:var(--pink);color:var(--blue);display:grid;place-items:center;font-weight:800;font-size:12px;flex:none}
  .who{min-width:0;display:flex;flex-direction:column}
  .who b{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .who code{font:500 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
  .meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:12px;padding-top:11px;border-top:1px solid var(--line);font-size:12px;color:var(--soft)}
  .meta b{font-weight:600;color:var(--muted);font-variant-numeric:tabular-nums}
  .note{margin-top:10px;font-size:12px;line-height:1.45;color:var(--muted)}
  .act{display:flex;align-items:center;gap:12px;margin-top:12px}
  .go{appearance:none;border:0;border-radius:10px;height:36px;padding:0 16px;font-family:inherit;font-weight:700;font-size:13.5px;line-height:1;background:var(--btn);color:var(--btn-text);cursor:pointer;transition:transform .08s ease,opacity .15s,filter .15s;white-space:nowrap}
  .go:hover{filter:brightness(1.08)}.go:active{transform:scale(.98)}.go:disabled{opacity:.55;cursor:default}
  .link{appearance:none;border:0;background:none;padding:0;font-family:inherit;font-weight:600;font-size:12.5px;line-height:1;color:var(--muted);cursor:pointer}
  .link:hover{color:var(--text);text-decoration:underline;text-underline-offset:3px}
  .timer{margin-left:auto;font-size:12px;color:var(--soft);font-variant-numeric:tabular-nums;white-space:nowrap}
  .state{display:none;align-items:center;gap:10px;margin-top:12px;padding:9px 12px;border-radius:12px;background:var(--surface);font-size:13px;line-height:1.35}
  .state.on{display:flex}
  .state > div:not(.ic){min-width:0;flex:1}
  .state b{font-weight:700}
  .state small{display:block;color:var(--muted);font-size:11.5px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .ic{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;flex:none;font-weight:800;font-size:12px}
  .ok .ic{background:var(--pink);color:var(--blue)}.bad .ic{background:rgba(217,71,143,.16);color:var(--pink-deep)}.mute .ic{background:var(--line);color:var(--muted)}
  .state .link{flex:none;color:var(--text)}
  .spin{width:13px;height:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;vertical-align:-2px;animation:s .7s linear infinite;margin-right:7px}
  @keyframes s{to{transform:rotate(1turn)}}
  .hide{display:none!important}
  .skel{height:96px;border-radius:12px;background:var(--surface);margin-top:12px}
  @media (prefers-reduced-motion:reduce){.spin{animation:none}.go{transition:none}}
</style></head>
<body>
<div class="card">
  <div class="top"><span class="mark">✦</span><span class="brand">Wura</span><span>· Send</span><span class="chip" id="net">Preview</span></div>
  <div id="loading" class="skel"></div>
  <div id="body" class="hide">
    <div class="main">
      <div class="amt"><b id="amt"></b><span>USDC</span></div>
      <div class="to"><div class="av" id="av"></div><div class="who"><b id="to"></b><code id="addr"></code></div></div>
    </div>
    <div class="meta">
      <span>Fee <b id="fee"></b></span>
      <span>Total <b id="total"></b></span>
      <span>Left today <b id="left"></b></span>
      <span>Cap <b id="cap"></b></span>
    </div>
    <div class="note hide" id="note"></div>
    <div class="act" id="act">
      <button class="go" id="approve">Approve</button>
      <button class="link" id="cancel">Cancel</button>
      <span class="timer" id="timer"></span>
    </div>
    <div class="state ok" id="s-ok"><div class="ic">✓</div><div><b id="ok-t"></b><small id="ok-s"></small></div></div>
    <div class="state mute" id="s-mute"><div class="ic">–</div><div><b id="mute-t"></b><small id="mute-s"></small></div></div>
    <div class="state bad" id="s-bad"><div class="ic">!</div><div><b id="bad-t"></b><small id="bad-s"></small></div></div>
    <button class="link hide" id="open">Open in Wura</button>
  </div>
</div>
<script type="module">
  const DEMO = ${demo};
  const $ = (id) => document.getElementById(id);
  let p = null, code = null, timer = null, done = false;
  const short = (a) => a ? a.slice(0, 4) + "…" + a.slice(-4) : "";
  function theme(t){ document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"; }
  // Shows a result row; "Open in Wura" / "View on Stellar" sits at its right.
  function show(kind, title, sub, link){
    done = true; clearInterval(timer); $("act").classList.add("hide"); $("note").classList.add("hide");
    const row = $("s-" + kind);
    row.classList.add("on"); $(kind + "-t").textContent = title; $(kind + "-s").textContent = sub || "";
    if (link) { const b = $("open"); b.textContent = link.label + " →"; b.dataset.url = link.url; row.appendChild(b); b.classList.remove("hide"); }
  }
  function render(data){
    p = data;
    $("loading").classList.add("hide"); $("body").classList.remove("hide");
    $("net").textContent = data.network === "mainnet" ? "Mainnet" : data.network === "testnet" ? "Testnet" : "Example";
    $("amt").textContent = data.amount;
    $("av").textContent = (data.to || "?").trim().charAt(0).toUpperCase();
    $("to").textContent = data.to; $("addr").textContent = short(data.toAddress);
    $("fee").textContent = data.network !== "mock" ? "network fee in XLM" : data.fee + " USDC";
    $("total").textContent = data.total + " USDC";
    $("left").textContent = data.dailyLeftAfter + " USDC";
    $("cap").textContent = data.perPaymentCap + " USDC";
    $("approve").textContent = data.inChat ? "Approve" : "Open in Wura to approve";
    if (!data.inChat) {
      $("note").textContent = "To approve here, turn on “Approve from chat apps” in Wura → Channels.";
      $("note").classList.remove("hide");
    }
    clearInterval(timer);
    const tick = () => {
      const s = Math.max(0, Math.round((data.expiresAt - Date.now()) / 1000));
      if (s <= 0) return show("mute", "Preview expired", "Prices and balances move.", { label: "Open in Wura", url: data.approveUrl });
      $("timer").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") + " left";
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
      if (r.isError) { show("bad", "Not sent", text, { label: "Open in Wura", url: p.approveUrl }); return; }
      const sc = r.structuredContent || {};
      const ref = sc.reference ? "Ref " + sc.reference.slice(0, 10) + "…" : "";
      show("ok", "Sent " + p.amount + " USDC to " + p.to, ref, sc.explorerUrl ? { label: "View on Stellar", url: sc.explorerUrl } : null);
    } catch (e) {
      $("approve").disabled = false; $("approve").textContent = "Approve";
      $("timer").textContent = "Didn’t go through. Try again.";
    }
  }
  if (DEMO) {
    theme(new URLSearchParams(location.search).get("theme") || "light");
    render(DEMO);
    const go = (u) => window.open(u, "_blank");
    $("open").onclick = () => go($("open").dataset.url);
    $("approve").onclick = () => DEMO.inChat ? approve(() => new Promise((r) => setTimeout(() => r({ content: [{ type: "text", text: "Sent" }], structuredContent: { reference: "12fc3141f27b6f8dd4b2d6899b16c757", explorerUrl: "https://stellar.expert/explorer/testnet/tx/12fc3141f27b6f8dd4b2d6899b16c757a3f728e2312445240cf03b218b495f0d" } }), 900))) : go(DEMO.approveUrl);
  } else {
    const { App } = await import("${baseUrl}/mcp-assets/app");
    const app = new App({ name: "Wura send preview", version: "0.3.0" });
    app.onhostcontextchanged = (ctx) => ctx && ctx.theme && theme(ctx.theme);
    app.ontoolresult = (result) => {
      code = (result._meta && result._meta.approvalCode) || null;
      if (result.structuredContent && result.structuredContent.intentId) render(result.structuredContent);
    };
    const openLink = async (url) => { try { await app.openLink({ url }); } catch (e) {} };
    $("open").onclick = () => openLink($("open").dataset.url);
    $("approve").onclick = () => p && !p.inChat ? openLink(p.approveUrl) : approve(() => app.callServerTool({ name: "approve_send", arguments: { intentId: p.intentId, approvalCode: code || "" } }));
    await app.connect();
    const ctx = app.getHostContext(); theme(ctx && ctx.theme);
  }
</script></body></html>`;
}
