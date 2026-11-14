import "server-only";

/**
 * Runtime switches. Everything defaults to mock mode, so the app runs with no
 * secrets at all.
 *
 * - Auth: Privy email OTP when NEXT_PUBLIC_PRIVY_APP_ID is set, otherwise a
 *   mocked email sign-in (any 6-digit code).
 * - Money: MONEY_MODE=mock (default) signs nothing. MONEY_MODE=testnet sends
 *   real USDC on Stellar testnet. Signing in testnet mode is done by:
 *     - "privy" (default): the user's Privy Stellar wallet signs in the
 *       browser, our server verifies and submits.
 *     - "server-dev": a throwaway testnet key the server derives per email.
 *       For local testing and team demos without Privy. Testnet only.
 */
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
/** Circle's USDC issuer on Stellar testnet. */
const CIRCLE_TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

export const config = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || "",
  get authMode(): "privy" | "mock" {
    return this.privyAppId ? "privy" : "mock";
  },
  moneyMode: (process.env.MONEY_MODE === "testnet" ? "testnet" : "mock") as
    | "mock"
    | "testnet",
  /** Only testnet is supported for real signing in this version. */
  stellarNetwork: "testnet" as const,
  horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
  networkPassphrase: TESTNET_PASSPHRASE,
  friendbotUrl: "https://friendbot.stellar.org",
  explorerTx: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  usdc: {
    code: "USDC",
    issuer: process.env.STELLAR_USDC_ISSUER || CIRCLE_TESTNET_USDC_ISSUER,
  },
  get usingCircleUsdc() {
    return this.usdc.issuer === CIRCLE_TESTNET_USDC_ISSUER;
  },
  testnetSigner: (process.env.TESTNET_SIGNER === "server-dev" ? "server-dev" : "privy") as
    | "privy"
    | "server-dev",
  /** "Tunde:G…,Ada:G…" — real testnet accounts for demo contacts. */
  testnetContacts: (process.env.TESTNET_CONTACTS || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [name, address] = p.split(":").map((x) => x.trim());
      return { name, address };
    })
    .filter((c) => c.name && /^G[A-Z2-7]{55}$/.test(c.address)),
  /** Comma-separated venue ids to treat as unreachable, e.g. "soroswap". For demos of the "venue down" path. */
  mockUnavailableVenues: (process.env.MOCK_UNAVAILABLE_VENUES || "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean),
  /** Telegram bot. Off unless the token, webhook secret and bot username are all set. */
  telegram: {
    get token() {
      return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
    },
    get webhookSecret() {
      return (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    },
    get botUsername() {
      return (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
    },
    /** Public https origin of this app, for links the bot sends. Falls back to the Vercel URL. */
    get appUrl() {
      const u = (process.env.APP_URL || "").trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
      return u.replace(/\/+$/, "");
    },
    get enabled() {
      return Boolean(this.token && this.webhookSecret && this.botUsername);
    },
  },
  /** How long a swap quote or send preview stays approvable. */
  quoteTtlMs: 60_000,
  /** How long a built transaction waits for the user's signature. */
  signTtlMs: 120_000,
  /** The chat model, or null to use the built-in rule parser. See llmConfig(). */
  get llm(): LlmConfig | null {
    return llmConfig();
  },
};

/** True when real testnet transactions are signed by the user's Privy wallet. */
export function privySigning() {
  return config.moneyMode === "testnet" && config.testnetSigner === "privy";
}

/** True when the server signs with a throwaway testnet key (dev only). */
export function serverDevSigning() {
  return config.moneyMode === "testnet" && config.testnetSigner === "server-dev";
}

const DEV_SECRET = "agent-dev-session-secret-mock-mode-only-not-for-real-money";

/**
 * Secret used to sign the session cookie. In mock mode a fixed development
 * secret is fine (nothing real is protected). Anything beyond mock requires
 * SESSION_SECRET.
 */
export function sessionSecret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return new TextEncoder().encode(s);
  if (config.authMode === "privy" || config.moneyMode !== "mock") {
    throw new Error(
      "SESSION_SECRET (32+ characters) is required when Privy or testnet signing is enabled.",
    );
  }
  return new TextEncoder().encode(DEV_SECRET);
}

/**
 * Chat model settings. You choose the provider and model; nothing is picked
 * for you. All three of LLM_PROVIDER, LLM_MODEL and LLM_API_KEY must be set,
 * otherwise (or with AGENT_BRAIN=rules) the built-in rule parser answers.
 *
 * - LLM_PROVIDER: "anthropic", "openai-compatible", or a preset that fills in
 *   the base URL for an OpenAI-compatible API (openai, deepseek, openrouter,
 *   gemini, groq).
 * - LLM_BASE_URL: required for "openai-compatible"; overrides a preset.
 * - LLM_REASONING_EFFORT: optional, sent only if set (Anthropic `effort`,
 *   OpenAI-style `reasoning_effort`). Leave empty if your model doesn't take it.
 */
export type LlmConfig = { provider: string; model: string; apiKey: string; baseUrl: string; effort: string };

const PRESET_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
};

function llmConfig(): LlmConfig | null {
  if (process.env.AGENT_BRAIN === "rules") return null;
  const provider = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
  const model = (process.env.LLM_MODEL || "").trim();
  const apiKey = (process.env.LLM_API_KEY || "").trim();
  if (!provider || !model || !apiKey) return null;
  const baseUrl = (process.env.LLM_BASE_URL || "").trim() || PRESET_BASE_URLS[provider] || "";
  if (provider !== "anthropic" && !baseUrl) {
    console.error(`LLM_PROVIDER=${provider} needs LLM_BASE_URL. Using the rule parser.`);
    return null;
  }
  return { provider, model, apiKey, baseUrl, effort: (process.env.LLM_REASONING_EFFORT || "").trim() };
}
