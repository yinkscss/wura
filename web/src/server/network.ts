/**
 * Which Stellar network the server talks to, and the boot refusals that keep
 * real money safe. Pure functions of the environment, so every refusal can be
 * tested. No "server-only" import on purpose: tests load this file directly.
 *
 * See docs/mainnet-plan.md, M1.
 */

export type MoneyMode = "mock" | "testnet" | "mainnet";
export type NetworkName = "testnet" | "mainnet";

/** Circle's USDC issuer on Stellar mainnet. Pinned by a test. Recheck: https://developers.circle.com/stablecoins/usdc-contract-addresses */
export const CIRCLE_MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** Circle's USDC issuer on Stellar testnet. */
export const CIRCLE_TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export type NetworkSpec = {
  name: NetworkName;
  passphrase: string;
  horizonUrl: string;
  /** Soroban RPC, for contract lookups and simulation (site connect). Empty on mainnet until SOROBAN_RPC_URL is set. */
  sorobanRpcUrl: string;
  /** Testnet only. Empty on mainnet: there is no faucet. */
  friendbotUrl: string;
  explorerBase: string;
  usdcIssuer: string;
};

const TESTNET: NetworkSpec = {
  name: "testnet",
  passphrase: "Test SDF Network ; September 2015",
  horizonUrl: "https://horizon-testnet.stellar.org",
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  friendbotUrl: "https://friendbot.stellar.org",
  explorerBase: "https://stellar.expert/explorer/testnet",
  usdcIssuer: CIRCLE_TESTNET_USDC_ISSUER,
};

const MAINNET: NetworkSpec = {
  name: "mainnet",
  passphrase: "Public Global Stellar Network ; September 2015",
  horizonUrl: "https://horizon.stellar.org",
  sorobanRpcUrl: "",
  friendbotUrl: "",
  explorerBase: "https://stellar.expert/explorer/public",
  usdcIssuer: CIRCLE_MAINNET_USDC_ISSUER,
};

type Env = Record<string, string | undefined>;

/** MONEY_MODE. Empty means mock. A value we don't know is a mistake, so it stops the boot. */
export function parseMoneyMode(env: Env): MoneyMode {
  const raw = (env.MONEY_MODE || "").trim().toLowerCase();
  if (raw === "" || raw === "mock") return "mock";
  if (raw === "testnet" || raw === "mainnet") return raw;
  throw new Error(`MONEY_MODE must be mock, testnet or mainnet. Got "${env.MONEY_MODE}".`);
}

/** The network for a mode. Mock uses testnet addresses, since nothing is ever sent. */
export function networkFor(mode: MoneyMode, env: Env): NetworkSpec {
  const base = mode === "mainnet" ? MAINNET : TESTNET;
  return {
    ...base,
    horizonUrl: (env.STELLAR_HORIZON_URL || "").trim() || base.horizonUrl,
    sorobanRpcUrl: (env.SOROBAN_RPC_URL || "").trim() || base.sorobanRpcUrl,
    usdcIssuer: (env.STELLAR_USDC_ISSUER || "").trim() || base.usdcIssuer,
  };
}

/** True when the environment is a Vercel Preview deployment. */
export function isPreview(env: Env): boolean {
  return (env.VERCEL_ENV || "").trim().toLowerCase() === "preview";
}

/** The kill switch. MONEY_KILL=1 (or true, on, yes) turns every real money move off. */
export function killSwitchOn(env: Env): boolean {
  return /^(1|true|on|yes)$/i.test((env.MONEY_KILL || "").trim());
}

/**
 * Every reason this environment must not start. Empty means fine.
 * Mock mode is never refused. Mainnet gets the strict checks.
 */
export function bootProblems(env: Env): string[] {
  const mode = parseMoneyMode(env);
  const net = networkFor(mode, env);
  const problems: string[] = [];

  if (mode === "testnet" && net.usdcIssuer === CIRCLE_MAINNET_USDC_ISSUER) {
    problems.push("Testnet is set to use the mainnet USDC issuer.");
  }
  if (mode !== "mainnet") return problems;

  if (isPreview(env)) {
    problems.push("MONEY_MODE=mainnet is not allowed in a Preview deployment. Previews stay on mock or testnet.");
  }
  if ((env.TESTNET_SIGNER || "").trim().toLowerCase() === "server-dev") {
    problems.push("TESTNET_SIGNER=server-dev can never run on mainnet.");
  }
  if (net.usdcIssuer !== CIRCLE_MAINNET_USDC_ISSUER) {
    problems.push("STELLAR_USDC_ISSUER must be Circle's mainnet issuer on mainnet (or left empty).");
  }
  if (/testnet/i.test(net.horizonUrl)) {
    problems.push("STELLAR_HORIZON_URL points at testnet while MONEY_MODE=mainnet.");
  }
  if (/testnet/i.test(net.sorobanRpcUrl)) {
    problems.push("SOROBAN_RPC_URL points at testnet while MONEY_MODE=mainnet.");
  }
  if ((env.SESSION_SECRET || "").length < 32) {
    problems.push("SESSION_SECRET (32+ characters) is required on mainnet.");
  }
  if ((env.TESTNET_CONTACTS || "").trim().length > 0) {
    problems.push("TESTNET_CONTACTS is set. Testnet addresses must not become contacts on mainnet.");
  }
  // Chat approvals are on whenever AGENT_KEY_SECRET is set. The five D2
  // conditions (docs/mainnet-plan.md) are not built yet (M11), so mainnet
  // refuses them. M11 replaces this check with the real ones.
  if ((env.AGENT_KEY_SECRET || "").length > 0) {
    problems.push("Chat approvals (AGENT_KEY_SECRET) are not allowed on mainnet until the D2 conditions are in place.");
  }
  return problems;
}

/** Throws with every reason at once. Called when the server loads its config. */
export function assertBootSafe(env: Env): void {
  const problems = bootProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start:\n- ${problems.join("\n- ")}`);
  }
}
