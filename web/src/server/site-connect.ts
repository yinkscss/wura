import "server-only";
import { createHash } from "node:crypto";
import type { AllowedSite, DiscoveryStep, SiteAction, SiteConnectRequest } from "@/lib/types";
import { usdc } from "@/lib/format";
import { config } from "./config";
import { ApiFailure } from "./errors";
import { checkBalance, checkLimits, limitsFor, log } from "./money";
import type { Session } from "./session";
import { signAndSubmit } from "./signer";
import { refuseInTestnet } from "./testnet";
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
  | { kind: "declined"; request: SiteConnectRequest };

/** "Connect to this site and buy X." */
export function requestSiteConnect(s: Session, input: { url: string; want?: string }): ConnectResult {
  refuseInTestnet("Site payments");
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
  if (input.remember === true) addAllowedSite(s, req.host);
  return { kind: "action", action: discover(s, w, req.host, req.want) };
}

/** Sign after approval. Re-checks everything; the preview isn't trusted on its own. */
export async function approveSiteAction(s: Session, input: { actionId: string; approve: unknown }) {
  const w = wallet(s.userId);
  const action = w.siteActions.get(String(input.actionId));
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
