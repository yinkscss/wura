import "server-only";
import { createHash } from "node:crypto";
import type { AllowedSite, DiscoveryStep, SiteAction, SiteConnectRequest } from "@/lib/types";
import { usdc } from "@/lib/format";
import { config, moneyLive, serverDevSigning } from "./config";
import { devKeypairFor } from "./dev-keys";
import { ApiFailure } from "./errors";
import { checkBalance, checkLimits, limitsFor, log } from "./money";
import type { Session } from "./session";
import { signAndSubmit } from "./signer";
import { scanSite } from "./site-scan";
import { describeToken, inspectContract, prepareCall, submitSoroban, type ContractInfo, type Prepared } from "./site-soroban";
import { signWithKeypair } from "./stellar";
import { finishSiteAction, needsSignature, park, usdcBalance } from "./testnet";
import type { NeedsSignature } from "@/lib/types";
import { encodeContractId } from "./strkey";
import { newId, wallet, type WalletState } from "./store";

/**
 * Site connect — docs/site-connect.md. Mocked in v1.
 *
 * Rules:
 *   - Before connecting to a site that isn't on the allow list, ask
 *     "Connect to this site?" and offer to add it.
 *   - The allow list is permission to connect, never permission to sign.
 *     Every signature still needs a preview and the user's approval.
 *   - Spending limits and the transaction log still apply.
 *   - If the contract can't be found, isn't verified, or the simulation fails,
 *     stop and say so. Never guess.
 *
 * Primary path (mocked here): fetch the page and its network calls → find the
 * Soroban contract address → check it's real and verified → read the function
 * list from the on-chain contract spec → build and simulate the transaction →
 * plain-language preview → sign only after approval.
 *
 * Live version: fetch with a server-side HTTP client, read the contract spec
 * from Stellar RPC (getLedgerEntries on the contract's Wasm), and simulate with
 * simulateTransaction. WalletConnect / Stellar Wallets Kit is the secondary
 * path. A hosted browser is out of scope until after the buildathon.
 *
 * In mock mode only fictional sites on reserved example domains work, so the
 * preview never pretends to have read a real website.
 */

type MockSite = {
  name: string;
  contractName: string;
  verified: boolean;
  /** null = no Soroban contract found on the page. */
  fn: string | null;
  argNames: Array<{ name: string; type: string }>;
  /** Example price per unit, in USDC cents. */
  unitPrice: number;
  unit: string;
  /** null = simulation fails. */
  simulates: boolean;
};

// Fictional sites on reserved example domains. Figures are examples.
const MOCK_SITES: Record<string, MockSite> = {
  "market.example.org": {
    name: "Example Market",
    contractName: "example_market",
    verified: true,
    fn: "buy",
    argNames: [
      { name: "item", type: "String" },
      { name: "qty", type: "u32" },
    ],
    unitPrice: 12_50,
    unit: "item",
    simulates: true,
  },
  "tickets.example.com": {
    name: "Example Tickets",
    contractName: "example_tickets",
    verified: true,
    fn: "purchase_ticket",
    argNames: [
      { name: "event", type: "Symbol" },
      { name: "seats", type: "u32" },
    ],
    unitPrice: 60_00, // over the example per-payment cap on purpose
    unit: "ticket",
    simulates: true,
  },
  "coins.example.net": {
    name: "Example Coin Shop",
    contractName: "example_coin_sale",
    verified: true,
    fn: "buy_tokens",
    argNames: [
      { name: "token", type: "Symbol" },
      { name: "amount_usdc", type: "i128" },
    ],
    unitPrice: 20_00,
    unit: "bundle",
    simulates: true,
  },
  "drainer.example.net": {
    name: "Unknown site",
    contractName: "unknown",
    verified: false,
    fn: "approve_all",
    argNames: [{ name: "spender", type: "Address" }],
    unitPrice: 1_00,
    unit: "call",
    simulates: true,
  },
  "broken.example.com": {
    name: "Example Broken Shop",
    contractName: "example_broken",
    verified: true,
    fn: "checkout",
    argNames: [{ name: "cart", type: "Bytes" }],
    unitPrice: 5_00,
    unit: "order",
    simulates: false,
  },
};

const EXAMPLE_SITE_FEE = 1; // cents, example network + service fee

export const EXAMPLE_SITES = Object.keys(MOCK_SITES);

export function parseSite(input: string): { host: string; url: string } {
  const raw = String(input ?? "").trim();
  if (!raw) throw new ApiFailure("BAD_REQUEST", "Which site? Paste its link.");
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new ApiFailure("BAD_REQUEST", "That doesn't look like a website link.");
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) {
    throw new ApiFailure("BAD_REQUEST", "That doesn't look like a website link.");
  }
  return { host, url: `https://${host}${url.pathname === "/" ? "" : url.pathname}` };
}

function isAllowed(w: WalletState, host: string) {
  return w.allowList.some((a) => a.host === host);
}

function displayName(host: string) {
  return MOCK_SITES[host]?.name ?? host;
}

function contractAddress(host: string) {
  return encodeContractId(createHash("sha256").update(`example-contract:${host}`).digest());
}

function requireExampleSite(host: string) {
  // Mock discovery only knows fictional sites on reserved example domains.
  const supported = /(^|\.)example\.(com|org|net)$/.test(host);
  if (!supported) {
    throw new ApiFailure(
      "SITE_UNSUPPORTED",
      `In this preview I can only connect to the example sites (${EXAMPLE_SITES.slice(0, 3).join(", ")}), so I haven't opened ${host}. Nothing was sent.`,
      400,
    );
  }
}

function qtyFrom(want: string) {
  const m = want.match(/\b(\d{1,2})\b/);
  const n = m ? parseInt(m[1], 10) : 1;
  return Math.min(Math.max(n, 1), 20);
}

/** Mocked contract discovery + simulation. Throws if anything is off. */
function discover(s: Session, w: WalletState, host: string, want: string): SiteAction {
  const site = MOCK_SITES[host];
  const address = contractAddress(host);
  const steps: DiscoveryStep[] = [{ label: "Read the page", detail: `Fetched ${host} and the calls it makes` }];

  if (!site || !site.fn) {
    throw new ApiFailure(
      "CONTRACT_NOT_FOUND",
      `I read ${host} but couldn't find a Soroban contract to call, so I stopped. Nothing was sent.`,
      404,
    );
  }
  steps.push({ label: "Found a Soroban contract", detail: address });
  if (!site.verified) {
    throw new ApiFailure(
      "CONTRACT_UNVERIFIED",
      `${host} points to a contract I can't verify, and it asks for broad approval. That's how drainer sites work, so I won't sign anything there.`,
      403,
    );
  }
  steps.push({ label: "Checked the contract", detail: `Verified · ${site.contractName}` });
  steps.push({ label: "Read its interface", detail: `${site.fn}(${site.argNames.map((a) => `${a.name}: ${a.type}`).join(", ")})` });
  if (!site.simulates) {
    throw new ApiFailure(
      "SIMULATION_FAILED",
      `The simulation of ${site.fn} on ${host} failed, so I don't know what it would really do. I stopped instead of guessing.`,
      422,
    );
  }

  const qty = qtyFrom(want);
  const price = site.unitPrice * qty;
  const fee = EXAMPLE_SITE_FEE;
  steps.push({ label: "Simulated it", detail: `Succeeds · costs ${usdc(price)}` });

  // Limits and balance apply to site payments too.
  checkLimits(w, "USDC", price);
  checkBalance(w, "USDC", price + fee);

  const item = want.replace(/^(a|an|the|some|\d+)\s+/i, "").trim() || site.unit;
  const args = site.argNames.map((a, i) => ({
    name: a.name,
    type: a.type,
    value: i === 0 ? JSON.stringify(item.slice(0, 40)) : a.type === "i128" ? String(price * 100_000) : String(qty),
  }));
  const limits = limitsFor(w);
  const action: SiteAction = {
    id: newId("sa"),
    host,
    siteName: site.name,
    want: item,
    contract: { address, verified: true, name: site.contractName },
    call: { fn: site.fn, args },
    steps,
    summary: `Pay ${usdc(price)} to ${site.name} for ${qty} × ${item}`,
    asset: "USDC",
    price,
    fee,
    total: price + fee,
    balanceBefore: w.balances.USDC,
    dailyRemainingAfter: limits.remainingToday.USDC - price,
    dailyLimit: limits.daily.USDC,
    perPaymentCap: limits.perPayment.USDC,
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
  };
  w.siteActions.set(action.id, action);
  void s;
  return action;
}

export type ConnectResult =
  | { kind: "permission"; request: SiteConnectRequest; siteName: string }
  | { kind: "action"; action: SiteAction }
  | { kind: "declined"; request: SiteConnectRequest }
  /** Real sites: permission was given. The agent now reads the site and prepares the call. */
  | { kind: "connected"; request: SiteConnectRequest };

/** "Connect to this site and buy X." */
export function requestSiteConnect(s: Session, input: { url: string; want?: string }): ConnectResult {
  if (moneyLive()) {
    // Real sites go through the model: it reads the contract's function list and chooses the call.
    throw new ApiFailure(
      "SIGNING_UNAVAILABLE",
      "I couldn't finish reading that site. Real sites need the AI model to pick the contract call, and it either isn't switched on or didn't answer in time. Nothing was sent. Try again.",
      503,
    );
  }
  const w = wallet(s.userId);
  const { host, url } = parseSite(input.url);
  requireExampleSite(host);
  const want = String(input.want ?? "").trim().slice(0, 80);
  if (!isAllowed(w, host)) {
    // Reuse an open question for the same site instead of stacking them.
    const open = [...w.siteRequests.values()].find((r) => r.host === host && r.status === "pending");
    const request: SiteConnectRequest = open
      ? { ...open, want: want || open.want }
      : { id: newId("sr"), host, url, want, createdAt: Date.now(), status: "pending" };
    w.siteRequests.set(request.id, request);
    return { kind: "permission", request, siteName: displayName(host) };
  }
  return { kind: "action", action: discover(s, w, host, want) };
}

/** The user's answer to "Connect to this site?". */
export function respondToConnect(
  s: Session,
  input: { requestId: string; connect: unknown; remember: unknown },
): ConnectResult {
  const w = wallet(s.userId);
  const req = w.siteRequests.get(String(input.requestId));
  if (!req) throw new ApiFailure("BAD_REQUEST", "That connection request doesn't exist any more. Ask again.", 404);
  if (req.status !== "pending") throw new ApiFailure("ALREADY_USED", "You've already answered that one.", 409);
  if (input.connect !== true) {
    req.status = "declined";
    return { kind: "declined", request: req };
  }
  req.status = "connected";
  req.createdAt = Date.now(); // the "just this once" permission runs from now
  if (input.remember === true) addAllowedSite(s, req.host);
  if (moneyLive()) return { kind: "connected", request: req };
  return { kind: "action", action: discover(s, w, req.host, req.want) };
}

/** Sign after approval. Re-checks everything; the preview isn't trusted on its own. */
export async function approveSiteAction(s: Session, input: { actionId: string; approve: unknown }) {
  const w = wallet(s.userId);
  const action = w.siteActions.get(String(input.actionId));
  if (action?.live) return approveLiveAction(s, input, action);
  if (!action) throw new ApiFailure("INTENT_NOT_FOUND", "That preview doesn't exist. Ask again.", 404);
  if (action.status !== "pending") throw new ApiFailure("ALREADY_USED", "That was already signed or cancelled.", 409);
  if (Date.now() > action.expiresAt) {
    action.status = "expired";
    throw new ApiFailure("QUOTE_EXPIRED", "That preview expired. Ask again and I'll simulate it fresh.", 410);
  }
  if (input.approve !== true) {
    throw new ApiFailure("NOT_APPROVED", "Nothing was signed. A site payment only goes ahead when you approve it.", 403);
  }
  checkLimits(w, action.asset, action.price);
  checkBalance(w, action.asset, action.total);

  const signed = await signAndSubmit({
    kind: "site",
    userAddress: s.address,
    description: `${action.call.fn} on ${action.contract.address} (${action.host})`,
  });
  action.status = "signed";
  w.balances.USDC -= action.total;
  w.spentToday.USDC += action.price;
  const entry = log(w, {
    kind: "site",
    detail: `${action.siteName} · ${action.call.fn}`,
    amount: usdc(action.price),
    status: "done",
    txRef: signed.txRef,
  });
  return { action, activity: entry, balances: { ...w.balances }, mock: signed.mock };
}

export function cancelSiteAction(s: Session, actionId: string) {
  const a = wallet(s.userId).siteActions.get(actionId);
  if (a && a.status === "pending") a.status = "cancelled";
  return { ok: true };
}

// ---------- Allow list ----------

export function getSites(s: Session) {
  const w = wallet(s.userId);
  return {
    allowed: w.allowList.slice().sort((a, b) => b.addedAt - a.addedAt),
    pending: [...w.siteRequests.values()].filter((r) => r.status === "pending").sort((a, b) => b.createdAt - a.createdAt),
    exampleSites: EXAMPLE_SITES,
  };
}

export function addAllowedSite(s: Session, input: string): AllowedSite {
  const w = wallet(s.userId);
  const { host } = parseSite(input);
  const existing = w.allowList.find((a) => a.host === host);
  if (existing) return existing;
  const site: AllowedSite = { host, name: displayName(host), addedAt: Date.now() };
  w.allowList.push(site);
  // Any open question for this site is now answered.
  for (const r of w.siteRequests.values()) if (r.host === host && r.status === "pending") r.status = "connected";
  return site;
}

export function removeAllowedSite(s: Session, host: string) {
  const w = wallet(s.userId);
  const h = String(host).toLowerCase();
  w.allowList = w.allowList.filter((a) => a.host !== h);
  return { ok: true };
}

export function dismissSiteRequest(s: Session, requestId: string) {
  const r = wallet(s.userId).siteRequests.get(requestId);
  if (r && r.status === "pending") r.status = "declined";
  return { ok: true };
}


// ---------- Real sites (testnet) ----------
//
// The model never sees page text. It gets structured facts: which contracts the
// page mentions, and each one's function list read from the chain. It picks a
// function and values; we rebuild, simulate and read what that would do, and
// the preview comes from the simulation. docs/site-connect.md.

const JUST_THIS_ONCE_MS = 30 * 60 * 1000;

function requireLive() {
  if (!moneyLive()) throw new ApiFailure("SIGNING_UNAVAILABLE", "Real sites need MONEY_MODE=testnet.", 503);
  if (config.stellarNetwork === "mainnet") {
    throw new ApiFailure("SIGNING_UNAVAILABLE", "Connecting to sites isn't switched on for mainnet yet. Nothing was sent.", 503);
  }
}

/** On the allow list, or the user said yes to this site in the last half hour. */
function isPermitted(w: WalletState, host: string) {
  if (isAllowed(w, host)) return true;
  const cutoff = Date.now() - JUST_THIS_ONCE_MS;
  return [...w.siteRequests.values()].some((r) => r.host === host && r.status === "connected" && r.createdAt > cutoff);
}

export type LiveInspection = {
  kind: "inspected";
  host: string;
  contracts: Array<{ address: string; mentions: number; functions: ContractInfo["functions"] }>;
  skipped: string[];
};

/** "Connect to this site": asks permission first, then reads the page and each contract's interface. */
export async function connectLive(s: Session, input: { url: string; want?: string }): Promise<ConnectResult | LiveInspection> {
  requireLive();
  const w = wallet(s.userId);
  const { host, url } = parseSite(input.url);
  const want = String(input.want ?? "").trim().slice(0, 80);
  if (!isPermitted(w, host)) {
    const open = [...w.siteRequests.values()].find((r) => r.host === host && r.status === "pending");
    const request: SiteConnectRequest = open
      ? { ...open, want: want || open.want }
      : { id: newId("sr"), host, url, want, createdAt: Date.now(), status: "pending" };
    w.siteRequests.set(request.id, request);
    return { kind: "permission", request, siteName: host };
  }
  const scan = await readSite(url);
  const found = await Promise.allSettled(scan.candidates.slice(0, 3).map((c) => inspectContract(c.address)));
  const contracts: LiveInspection["contracts"] = [];
  found.forEach((r, i) => {
    if (r.status === "fulfilled") contracts.push({ address: r.value.address, mentions: scan.candidates[i].mentions, functions: r.value.functions.slice(0, 40) });
  });
  if (contracts.length === 0) {
    throw new ApiFailure(
      "CONTRACT_NOT_FOUND",
      scan.candidates.length
        ? `I read ${host} and found contract addresses, but none of them is a contract I can read on ${config.stellarNetwork}, so I stopped. Nothing was sent.`
        : `I read ${host} but couldn't find a Soroban contract to call, so I stopped. Nothing was sent.`,
      404,
    );
  }
  return { kind: "inspected", host, contracts, skipped: scan.skipped };
}

async function readSite(url: string) {
  try {
    return await scanSite(url);
  } catch (err) {
    console.error("site read failed", url, err instanceof Error ? err.message : err);
    throw new ApiFailure("CONTRACT_NOT_FOUND", `I couldn't open that site (${err instanceof Error && err.name === "FetchRefused" ? err.message : "it didn't answer"}). Nothing was sent.`, 404);
  }
}

function summaryFor(price: number, host: string, fn: string, gets: string[]) {
  return price > 0 ? `Pay ${usdc(price)} to ${host}${gets.length ? ` and receive ${gets.join(", ")}` : ""}` : `Call ${fn} on ${host} (no payment)`;
}

/**
 * An approval link was opened after its preview expired (a person reads the reply, opens the
 * link, signs in). Simulate the same call again and show the fresh figures, with a new clock.
 * Limits and balance are checked again. Nothing is signed.
 */
export async function refreshLiveAction(s: Session, action: SiteAction): Promise<SiteAction> {
  requireLive();
  if (!action.live || !action.liveCall) throw new ApiFailure("QUOTE_EXPIRED", "That preview expired. Ask your assistant again and I'll simulate it fresh.", 410);
  if (action.status !== "pending" && action.status !== "expired") return action;
  const w = wallet(s.userId);
  const fresh = await prepareCall(s.address, action.liveCall);
  const price = fresh.spend.usdcCents;
  checkLimits(w, "USDC", price);
  const balance = price > 0 ? await usdcBalance(s) : 0;
  if (price > balance) throw new ApiFailure("INSUFFICIENT_BALANCE", "You don't have enough USDC for that on testnet.", 403);
  const limits = limitsFor(w);
  const gets = describeGets(fresh);
  Object.assign(action, {
    call: { fn: action.liveCall.fn, args: fresh.args },
    steps: action.steps.map((st, i) => (i === 3 ? { ...st, detail: `Succeeds · takes ${price > 0 ? `$${(price / 100).toFixed(2)} USDC` : "no money"} from you` } : st)),
    summary: summaryFor(price, action.host, action.liveCall.fn, gets),
    price,
    total: price,
    balanceBefore: balance,
    dailyRemainingAfter: limits.remainingToday.USDC - price,
    gets,
    feeXlm: (fresh.feeStroops / 1e7).toFixed(5),
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
  });
  return action;
}

function describeGets(p: Prepared) {
  return p.spend.incoming.map((t) => `${describeToken(t.token)} ${(Number(t.amount) / 1e7).toLocaleString("en-US", { maximumFractionDigits: 7 })}`);
}

/** The model chose a function and values. Rebuild and simulate it, and show what it would really do. */
export async function prepareLiveCall(
  s: Session,
  input: { url: string; contract: string; fn: string; args: Record<string, unknown>; want?: string },
): Promise<SiteAction> {
  requireLive();
  const w = wallet(s.userId);
  const { host, url } = parseSite(input.url);
  if (!isPermitted(w, host)) throw new ApiFailure("SITE_NOT_ALLOWED", `You haven't allowed me to connect to ${host} yet.`, 403);

  // The contract must be one this site's own pages mention. The model can't aim a call at an arbitrary contract.
  const scan = await readSite(url);
  if (!scan.candidates.some((c) => c.address === input.contract)) {
    throw new ApiFailure("CONTRACT_UNVERIFIED", `${host} doesn't point to that contract, so I won't call it.`, 403);
  }
  const prepared = await prepareCall(s.address, { contract: input.contract, fn: input.fn, args: input.args });
  const price = prepared.spend.usdcCents;
  checkLimits(w, "USDC", price);
  if (price > 0 && price > (await usdcBalance(s))) {
    throw new ApiFailure("INSUFFICIENT_BALANCE", "You don't have enough USDC for that on testnet.", 403);
  }
  const limits = limitsFor(w);
  const gets = describeGets(prepared);
  const action: SiteAction = {
    id: newId("sa"),
    host,
    siteName: host,
    want: String(input.want ?? "").trim().slice(0, 80),
    contract: { address: input.contract, verified: true, name: "Deployed · interface read from the chain" },
    call: { fn: input.fn, args: prepared.args },
    steps: [
      { label: "Read the page", detail: `${scan.fetched.length} file${scan.fetched.length === 1 ? "" : "s"} from ${host}` },
      { label: "Found the contract", detail: input.contract },
      { label: "Read its interface", detail: `${input.fn}(${prepared.args.map((a) => `${a.name}: ${a.type}`).join(", ")})` },
      { label: "Simulated it", detail: `Succeeds · takes ${price > 0 ? `$${(price / 100).toFixed(2)} USDC` : "no money"} from you` },
    ],
    summary: summaryFor(price, host, input.fn, gets),
    asset: "USDC",
    price,
    fee: 0,
    total: price,
    balanceBefore: price > 0 ? await usdcBalance(s) : 0,
    dailyRemainingAfter: limits.remainingToday.USDC - price,
    dailyLimit: limits.daily.USDC,
    perPaymentCap: limits.perPayment.USDC,
    expiresAt: Date.now() + config.quoteTtlMs,
    status: "pending",
    live: true,
    gets,
    feeXlm: (prepared.feeStroops / 1e7).toFixed(5),
    liveCall: { url, contract: input.contract, fn: input.fn, args: input.args },
  };
  w.siteActions.set(action.id, action);
  return action;
}

async function approveLiveAction(
  s: Session,
  input: { actionId: string; approve: unknown },
  action: SiteAction,
): Promise<NeedsSignature | { status: "done"; action: SiteAction; activity: ReturnType<typeof log>; mock: false }> {
  requireLive();
  const w = wallet(s.userId);
  if (action.status !== "pending") throw new ApiFailure("ALREADY_USED", "That was already signed or cancelled.", 409);
  if (Date.now() > action.expiresAt) {
    action.status = "expired";
    throw new ApiFailure("QUOTE_EXPIRED", "That preview expired. Ask again and I'll simulate it fresh.", 410);
  }
  if (input.approve !== true) {
    throw new ApiFailure("NOT_APPROVED", "Nothing was signed. A site payment only goes ahead when you approve it.", 403);
  }
  if (!action.liveCall) throw new ApiFailure("INTENT_NOT_FOUND", "That preview can't be rebuilt. Ask again.", 404);
  // The preview isn't trusted on its own: rebuild and simulate again, and refuse if it now costs more or does something else.
  const fresh = await prepareCall(s.address, action.liveCall);
  const sameGets = describeGets(fresh).join("|") === (action.gets ?? []).join("|");
  if (fresh.spend.usdcCents > action.price || !sameGets) {
    throw new ApiFailure("QUOTE_EXPIRED", "What that call does changed since the preview, so I stopped. Ask again and I'll show you the new one.", 409);
  }
  checkLimits(w, "USDC", fresh.spend.usdcCents);
  if (fresh.spend.usdcCents > 0 && fresh.spend.usdcCents > (await usdcBalance(s))) {
    throw new ApiFailure("INSUFFICIENT_BALANCE", "You don't have enough USDC for that on testnet.", 403);
  }
  const tx = { xdr: fresh.xdr, hash: fresh.hash };
  if (serverDevSigning()) {
    const hash = await submitSoroban(signWithKeypair(tx.xdr, devKeypairFor(s.email)));
    return { status: "done", action, activity: finishSiteAction(w, action, hash), mock: false };
  }
  return needsSignature(s, park(w, tx, "site", action.id));
}
