import { createPrivateKey, createSign } from "node:crypto";
import { formatUnits } from "../units";
import { BASE_USDC, USDC_DECIMALS } from "../ramp/paycrest";

/**
 * Privy wallet on Base: the staging wallet that receives bridged USDC and then
 * pays the Paycrest deposit address. See docs/offramp-implementation.md.
 *
 * Who holds the keys: the wallet is OWNED BY THE USER (owner.user_id). Wura's
 * server is only a scoped additional signer, limited by a Privy policy to the
 * Base USDC contract and a per-transfer cap. It is not an app-owned wallet, so
 * "Wura never holds user funds" (mainnet-plan.md) still holds. Whether Privy
 * lets an additional signer send sponsored transactions is NOT confirmed (see
 * the implementation doc); the code works either way.
 *
 * Gas, by `sponsor` mode:
 *   "app"  : Wura pays through Privy gas credits. The wallet needs no ETH and the
 *            USDC amount sent stays exact. Preferred.
 *   "usdc" : gas is taken from the wallet's USDC. Fallback. The wallet must hold
 *            the order amount plus a little extra.
 *   "none" : no sponsorship; the wallet needs ETH. Refused on mainnet by default.
 *
 * Refusals in `sendUsdc`: bad or zero-address recipient, the USDC contract or the
 * wallet itself as recipient, zero amount, an amount over the per-transfer cap,
 * and a wallet that isn't on the allowed list for this call.
 *
 * Written from Privy's docs, read 27 November 2026, NOT yet run against the live
 * API. Marked "unverified" below: the request-signature canonical form, the
 * `additional_signers` field, and the transaction-status endpoint. Check each
 * on the first real call. Secrets never appear in an error or a log line.
 *
 * No app imports on purpose, so `node --test` can load it.
 */

export const BASE_CAIP2 = "eip155:8453";
const PRIVY_API = "https://api.privy.io";
const DEFAULT_RPC = "https://mainnet.base.org";
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
const TRANSFER_SELECTOR = "a9059cbb"; // transfer(address,uint256)
const BALANCE_OF_SELECTOR = "70a08231"; // balanceOf(address)
const DEFAULT_MAX_TRANSFER_UNITS = BigInt(100) * BigInt(1_000_000); // 100 USDC

export class PrivyEvmError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "PrivyEvmError";
    this.status = status;
  }
}

export type SponsorMode = "app" | "usdc" | "none";
export type PrivyEvmEnv = Record<string, string | undefined>;

export interface PrivyEvmDeps {
  fetch?: typeof fetch;
  env?: PrivyEvmEnv;
  /** Largest single USDC transfer this client will send, micro-USDC. Default 100 USDC. */
  maxTransferUnits?: bigint;
}

export interface SendUsdcInput {
  walletId: string;
  /** The wallet's own address, to refuse a self-send. */
  walletAddress: string;
  to: string;
  amountUnits: bigint;
  /** Our cash-out id. Sent as Privy's idempotency key so a retry can't pay twice. */
  idempotencyKey: string;
  sponsor?: SponsorMode;
}

export interface SentTransfer {
  transactionId: string | null;
  /** Empty until confirmed. */
  hash: string | null;
  userOperationHash: string | null;
}

export interface TransferStatus {
  state: "pending" | "confirmed" | "failed" | "unknown";
  hash: string | null;
}

export interface PrivyEvmClient {
  /** Creates a user-owned Ethereum wallet with Wura's scoped signer and spend policy attached. Call `findWallet` first so a user never gets two. */
  createWallet(userId: string): Promise<{ id: string; address: string }>;
  findWallet(userId: string): Promise<{ id: string; address: string } | null>;
  sendUsdc(input: SendUsdcInput): Promise<SentTransfer>;
  getTransfer(transactionId: string): Promise<TransferStatus>;
  /** USDC on Base, read straight from the chain (not from Privy). Micro-USDC. */
  usdcBalance(address: string): Promise<bigint>;
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/** ERC-20 `transfer(to, amount)` calldata. Exported for tests. */
export function encodeTransfer(to: string, amountUnits: bigint): string {
  if (!EVM_ADDRESS.test(to)) throw new PrivyEvmError("Bad recipient address.");
  if (amountUnits < BigInt(0)) throw new PrivyEvmError("Negative amount.");
  const addr = to.slice(2).toLowerCase().padStart(64, "0");
  const amt = amountUnits.toString(16).padStart(64, "0");
  if (amt.length > 64) throw new PrivyEvmError("Amount too large.");
  return `0x${TRANSFER_SELECTOR}${addr}${amt}`;
}

/** JSON with sorted keys, no whitespace (RFC 8785 for the plain values we send). */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

/**
 * Privy request signature (`privy-authorization-signature`): ECDSA P-256 over the
 * canonical JSON of { version: 1, method, url, body, headers: { "privy-app-id" } }.
 * The key is the dashboard's "wallet-auth:<base64 PKCS8>" value. UNVERIFIED against
 * the live API: confirm with one real call before relying on it.
 */
export function authorizationSignature(
  key: string,
  parts: { method: string; url: string; body: unknown; appId: string },
): string {
  const der = Buffer.from(key.replace(/^wallet-auth:/, ""), "base64");
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const payload = canonicalJson({
    version: 1,
    method: parts.method,
    url: parts.url,
    body: parts.body,
    headers: { "privy-app-id": parts.appId },
  });
  return createSign("sha256").update(payload).sign(privateKey).toString("base64");
}

export function privyEvmReady(env: PrivyEvmEnv = process.env): boolean {
  return ["NEXT_PUBLIC_PRIVY_APP_ID", "PRIVY_APP_SECRET", "PRIVY_WALLET_AUTH_KEY", "PRIVY_BASE_SIGNER_ID"].every(
    (k) => (env[k] ?? "").trim().length > 0,
  );
}

export function createPrivyEvm(deps: PrivyEvmDeps = {}): PrivyEvmClient {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;
  const cap = deps.maxTransferUnits ?? DEFAULT_MAX_TRANSFER_UNITS;
  const appId = (env.NEXT_PUBLIC_PRIVY_APP_ID ?? "").trim();
  const secret = (env.PRIVY_APP_SECRET ?? "").trim();
  const rpc = (env.BASE_RPC_URL?.trim() || DEFAULT_RPC).replace(/\/+$/, "");
  if (!rpc.startsWith("https://")) throw new PrivyEvmError("BASE_RPC_URL must be https.");

  async function privy(
    method: "GET" | "POST",
    path: string,
    opts: { body?: unknown; sign?: boolean; idempotencyKey?: string } = {},
  ): Promise<Record<string, unknown>> {
    if (!appId || !secret) throw new PrivyEvmError("Privy isn't configured.");
    const url = `${PRIVY_API}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`,
      "privy-app-id": appId,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["privy-idempotency-key"] = opts.idempotencyKey;
    if (opts.sign) {
      const key = (env.PRIVY_WALLET_AUTH_KEY ?? "").trim();
      if (!key) throw new PrivyEvmError("Privy signing key isn't configured.");
      try {
        headers["privy-authorization-signature"] = authorizationSignature(key, { method, url, body: opts.body, appId });
      } catch {
        throw new PrivyEvmError("Couldn't sign the Privy request.");
      }
    }
    let res: Response;
    try {
      res = await doFetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new PrivyEvmError("Couldn't reach Privy.");
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    if (!res.ok) {
      const msg = str(asObject(json).error) ?? str(asObject(json).message);
      throw new PrivyEvmError(msg ? `Privy refused: ${msg.slice(0, 200)}` : `Privy answered ${res.status}.`, res.status);
    }
    return asObject(json);
  }

  async function chain(method: string, params: unknown[]): Promise<string> {
    let res: Response;
    try {
      res = await doFetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PrivyEvmError("Couldn't reach Base.");
    }
    const j = asObject(await res.json().catch(() => null));
    const out = str(j.result);
    if (!res.ok || !out) throw new PrivyEvmError("Base answered with an error.");
    return out;
  }

  function wallet(w: Record<string, unknown>): { id: string; address: string } | null {
    const id = str(w.id);
    const address = str(w.address);
    return id && address && EVM_ADDRESS.test(address) && str(w.chain_type) === "ethereum" ? { id, address } : null;
  }

  return {
    async createWallet(userId) {
      if (!/^did:privy:[A-Za-z0-9]+$/.test(userId)) throw new PrivyEvmError("Bad user id.");
      const signerId = (env.PRIVY_BASE_SIGNER_ID ?? "").trim();
      if (!signerId) throw new PrivyEvmError("The Base signer isn't configured.");
      const policyId = (env.PRIVY_BASE_POLICY_ID ?? "").trim();
      const w = await privy("POST", "/v1/wallets", {
        body: {
          chain_type: "ethereum",
          owner: { user_id: userId },
          // UNVERIFIED field: how Privy attaches a scoped signer and its policy on create.
          additional_signers: [{ signer_id: signerId, ...(policyId ? { override_policy_ids: [policyId] } : {}) }],
        },
      });
      const out = wallet(w);
      if (!out) throw new PrivyEvmError("Privy sent an unexpected wallet.");
      return out;
    },

    async findWallet(userId) {
      if (!/^did:privy:[A-Za-z0-9]+$/.test(userId)) throw new PrivyEvmError("Bad user id.");
      const u = await privy("GET", `/v1/users/${encodeURIComponent(userId)}`);
      const accounts = Array.isArray(u.linked_accounts) ? u.linked_accounts.map(asObject) : [];
      const hit = accounts.find((a) => a.type === "wallet" && a.chain_type === "ethereum" && str(a.id));
      if (!hit) return null;
      const out = wallet({ ...hit, id: hit.id ?? hit.wallet_id });
      return out;
    },

    async sendUsdc(input) {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.walletId)) throw new PrivyEvmError("Bad wallet id.");
      if (!EVM_ADDRESS.test(input.walletAddress)) throw new PrivyEvmError("Bad wallet address.");
      if (!EVM_ADDRESS.test(input.to) || input.to.toLowerCase() === ZERO_ADDRESS) throw new PrivyEvmError("Bad recipient address.");
      if (input.to.toLowerCase() === BASE_USDC.toLowerCase()) throw new PrivyEvmError("Refusing to send USDC to the USDC contract.");
      if (input.to.toLowerCase() === input.walletAddress.toLowerCase()) throw new PrivyEvmError("Refusing to send to the wallet itself.");
      if (input.amountUnits <= BigInt(0)) throw new PrivyEvmError("Amount must be above zero.");
      if (input.amountUnits > cap) throw new PrivyEvmError(`Over the per-transfer limit of ${formatUnits(cap, USDC_DECIMALS)} USDC.`);
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.idempotencyKey)) throw new PrivyEvmError("Bad idempotency key.");
      const sponsor = input.sponsor ?? "app";
      if (sponsor === "none" && env.PRIVY_ALLOW_UNSPONSORED !== "1") {
        throw new PrivyEvmError("Unsponsored sends are off; the wallet has no ETH for gas.");
      }

      const body: Record<string, unknown> = {
        method: "eth_sendTransaction",
        caip2: BASE_CAIP2,
        params: { transaction: { to: BASE_USDC, value: "0x0", data: encodeTransfer(input.to, input.amountUnits) } },
      };
      if (sponsor === "app") body.sponsor = true;
      if (sponsor === "usdc") {
        body.sponsor = true;
        body.sponsor_options = { asset: "usdc" };
      }

      const r = await privy("POST", `/v1/wallets/${input.walletId}/rpc`, { body, sign: true, idempotencyKey: input.idempotencyKey });
      const d = asObject(r.data);
      const src = Object.keys(d).length ? d : r;
      const transactionId = str(src.transaction_id);
      const hash = str(src.hash);
      if (!transactionId && !hash) throw new PrivyEvmError("Privy sent no transaction id.");
      return { transactionId, hash, userOperationHash: str(src.user_operation_hash) };
    },

    async getTransfer(transactionId) {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(transactionId)) throw new PrivyEvmError("Bad transaction id.");
      // UNVERIFIED endpoint: the docs describe `transaction_id` and a `transaction.confirmed` webhook.
      const t = await privy("GET", `/v1/transactions/${transactionId}`);
      const s = (str(t.status) ?? "").toLowerCase();
      const state = ["confirmed", "finalized", "success"].includes(s)
        ? "confirmed"
        : ["failed", "reverted", "rejected", "execution_reverted"].includes(s)
          ? "failed"
          : ["pending", "broadcasted", "submitted", "queued"].includes(s)
            ? "pending"
            : "unknown";
      return { state, hash: str(t.transaction_hash) ?? str(t.hash) };
    },

    async usdcBalance(address) {
      if (!EVM_ADDRESS.test(address)) throw new PrivyEvmError("Bad address.");
      const data = `0x${BALANCE_OF_SELECTOR}${address.slice(2).toLowerCase().padStart(64, "0")}`;
      const out = await chain("eth_call", [{ to: BASE_USDC, data }, "latest"]);
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(out)) throw new PrivyEvmError("Base sent an unexpected balance.");
      return BigInt(out);
    },
  };
}

/** In-memory stand-in with the same shapes. Nothing is signed or sent. */
export function createMockPrivyEvm(): PrivyEvmClient & { fund(address: string, units: bigint): void; confirm(transactionId: string): void } {
  const wallets = new Map<string, { id: string; address: string }>();
  const balances = new Map<string, bigint>();
  const sent = new Map<string, SentTransfer>();
  const status = new Map<string, TransferStatus["state"]>();
  let n = 0;
  return {
    async createWallet(userId) {
      const existing = wallets.get(userId);
      if (existing) return existing;
      n++;
      const w = { id: `mock-wallet-${n}`.padEnd(12, "0"), address: "0x" + n.toString(16).padStart(40, "0") };
      wallets.set(userId, w);
      return w;
    },
    async findWallet(userId) {
      return wallets.get(userId) ?? null;
    },
    async sendUsdc(input) {
      if (!EVM_ADDRESS.test(input.to)) throw new PrivyEvmError("Bad recipient address.");
      const prior = sent.get(input.idempotencyKey);
      if (prior) return prior; // same key, same result: a retry can't pay twice
      const have = balances.get(input.walletAddress.toLowerCase()) ?? BigInt(0);
      if (have < input.amountUnits) throw new PrivyEvmError("Not enough USDC.");
      balances.set(input.walletAddress.toLowerCase(), have - input.amountUnits);
      const r = { transactionId: `mock-tx-${input.idempotencyKey}`.slice(0, 64), hash: null, userOperationHash: null };
      sent.set(input.idempotencyKey, r);
      status.set(r.transactionId, "pending");
      return r;
    },
    async getTransfer(id) {
      return { state: status.get(id) ?? "unknown", hash: status.get(id) === "confirmed" ? "0x" + "ef".repeat(32) : null };
    },
    async usdcBalance(address) {
      return balances.get(address.toLowerCase()) ?? BigInt(0);
    },
    fund(address, units) {
      balances.set(address.toLowerCase(), (balances.get(address.toLowerCase()) ?? BigInt(0)) + units);
    },
    confirm(id) {
      status.set(id, "confirmed");
    },
  };
}

// Re-exported so callers import the Base USDC facts from one place.
export { BASE_USDC, USDC_DECIMALS };
