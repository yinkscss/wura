"use client";

import { useLoginWithEmail, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet } from "@privy-io/react-auth/extended-chains";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BackIcon, CheckIcon, ShieldIcon, SparkIcon, WalletIcon } from "@/components/icons";
import { SignInStickers } from "@/components/landing/sign-in-stickers";
import { PRIVY_ENABLED } from "@/components/providers";
import { Starfield } from "@/components/starfield";
import { Button, Card, Wordmark, cx } from "@/components/ui";

type Step = "email" | "code" | "wallet";

type Handlers = {
  sendCode: (email: string) => Promise<void>;
  verify: (email: string, code: string) => Promise<{ firstTime: boolean }>;
  mock: boolean;
  /** Privy already knows this browser: offer "Continue as …" instead of a new code. */
  existingEmail?: string | null;
  /** Forget that Privy session, to sign in with a different email. */
  forgetExisting?: () => Promise<void>;
};

export function SignIn() {
  return PRIVY_ENABLED ? <PrivySignIn /> : <MockSignIn />;
}

function MockSignIn() {
  return (
    <SignInScreen
      handlers={{
        mock: true,
        async sendCode() {
          await new Promise((r) => setTimeout(r, 500));
        },
        async verify(email, code) {
          const res = await fetch("/api/auth/mock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error?.message ?? "Sign-in failed. Try again.");
          return { firstTime: true };
        },
      }}
    />
  );
}

type LinkedWallet = { type: string; chainType?: string; address?: string; walletClientType?: string };

function findStellar(accounts: unknown[] | undefined) {
  return (accounts as LinkedWallet[] | undefined)?.find(
    (a) => a.type === "wallet" && a.chainType === "stellar" && a.address,
  )?.address;
}

function PrivySignIn() {
  const userRef = useRef<{ linkedAccounts?: unknown[] } | null>(null);
  const { sendCode, loginWithCode } = useLoginWithEmail({
    onComplete: ({ user }) => {
      userRef.current = user;
    },
  });
  const { getAccessToken, user, authenticated, ready, logout } = usePrivy();
  const existingEmail = ready && authenticated ? (user?.email?.address ?? null) : null;
  const { createWallet } = useCreateWallet();
  useEffect(() => {
    if (user) userRef.current = user;
  }, [user]);

  return (
    <SignInScreen
      handlers={{
        mock: false,
        existingEmail,
        async forgetExisting() {
          await logout();
          userRef.current = null;
        },
        async sendCode(email) {
          await sendCode({ email });
        },
        async verify(email, code) {
          if (!authenticated) await loginWithCode({ code });
          // onComplete fires as part of login; give state one tick to settle.
          for (let i = 0; i < 20 && !userRef.current; i++) await new Promise((r) => setTimeout(r, 50));
          let address = findStellar(userRef.current?.linkedAccounts);
          let firstTime = false;
          if (!address) {
            const out = await createWallet({ chainType: "stellar" });
            address = out.wallet.address;
            firstTime = true;
          }
          const accessToken = await getAccessToken();
          const res = await fetch("/api/auth/privy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accessToken, address, email }),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error?.message ?? "Sign-in failed. Try again.");
          return { firstTime };
        },
      }}
    />
  );
}

function SignInScreen({ handlers }: { handlers: Handlers }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [step, setStep] = useState<Step>("email");
  const [differentEmail, setDifferentEmail] = useState(false);
  const existing = !differentEmail && step === "email" ? handlers.existingEmail : null;
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await handlers.sendCode(email.trim().toLowerCase());
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(code: string, asEmail?: string) {
    setError(null);
    setBusy(true);
    setStep("wallet");
    try {
      const [{ firstTime }] = await Promise.all([
        handlers.verify((asEmail ?? email).trim().toLowerCase(), code),
        new Promise((r) => setTimeout(r, 1400)), // let the wallet moment land
      ]);
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(safeNext ?? (firstTime ? "/onboarding" : "/wallet"));
    } catch (err) {
      if (asEmail) {
        // Continuing an existing session failed: fall back to a fresh email code.
        setDifferentEmail(true);
        setStep("email");
        setError(err instanceof Error ? err.message : "Couldn't continue. Sign in with your email instead.");
        return;
      }
      setStep("code");
      setDigits(Array(6).fill(""));
      setError(err instanceof Error ? err.message : "That code didn't work. Try again.");
      setTimeout(() => inputs.current[0]?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }

  function setDigit(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) {
      // pasted
      const arr = clean.slice(0, 6).split("");
      const nextDigits = Array(6).fill("").map((_, k) => arr[k] ?? "");
      setDigits(nextDigits);
      if (arr.length === 6) void submitCode(arr.join(""));
      else inputs.current[arr.length]?.focus();
      return;
    }
    const nextDigits = digits.slice();
    nextDigits[i] = clean;
    setDigits(nextDigits);
    if (clean && i < 5) inputs.current[i + 1]?.focus();
    if (nextDigits.every((d) => d) && clean) void submitCode(nextDigits.join(""));
  }

  return (
    <div className="hero-sky relative min-h-dvh overflow-hidden text-white">
      <Starfield arc interactive shooting fadeFrom={0.55} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_30%,rgba(90,170,255,0.35),transparent_70%)]" />
      <SignInStickers />
      <header className="relative z-10 flex items-center justify-between px-5 py-6 sm:px-12">
        <Wordmark />
        <Link href="/" className="text-[13.5px] font-medium text-white/85 hover:text-white">
          Back to home
        </Link>
      </header>

      <main className="relative z-10 mx-auto grid max-w-[1120px] items-center gap-10 px-5 pb-20 pt-4 sm:px-8 lg:grid-cols-[1fr_440px] lg:pt-12">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-[520px]"
        >
          <h1 className="text-balance text-[40px] font-bold leading-[1.02] tracking-[-0.045em] sm:text-[56px]">
            Sign in with email. We’ll create your Stellar wallet.
          </h1>
          <p className="mt-5 text-[16.5px] leading-relaxed text-white/85">
            No app to install and no seed phrase to write down. One email, one wallet, and the same assistant everywhere you chat.
          </p>
          <ul className="mt-7 hidden flex-col gap-3 text-[15px] text-white/90 sm:flex">
            {[
              [WalletIcon, "A Stellar address that’s yours, made on first sign-in"],
              [ShieldIcon, "Nothing moves until you approve it"],
              [SparkIcon, "USDC works straight away, with no ID"],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof WalletIcon;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="grid size-8 place-items-center rounded-full bg-white/12 text-white">
                    <I size={16} />
                  </span>
                  {text as string}
                </li>
              );
            })}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Card className="relative overflow-hidden rounded-card-lg p-7 text-blue shadow-deep sm:p-8">
            <AnimatePresence mode="wait" initial={false}>
              {existing && (
                <motion.div
                  key="continue"
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col gap-5"
                >
                  <div>
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-soft">Welcome back</div>
                    <h2 className="mt-2 text-[26px] font-bold tracking-[-0.035em]">Continue as</h2>
                    <p className="mt-1.5 break-all text-[16px] font-semibold">{existing}</p>
                    <p className="mt-1.5 text-[14.5px] text-muted">You’re still signed in on this browser, so no code is needed.</p>
                  </div>
                  {error && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{error}</p>}
                  <Button size="lg" disabled={busy} onClick={() => void submitCode("", existing)}>
                    Continue
                  </Button>
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[13.5px] font-semibold text-muted underline underline-offset-4 hover:text-blue"
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await handlers.forgetExisting?.();
                      } finally {
                        setDifferentEmail(true);
                        setBusy(false);
                      }
                    }}
                  >
                    Use a different email
                  </button>
                </motion.div>
              )}
              {step === "email" && !existing && (
                <motion.form
                  key="email"
                  onSubmit={onEmail}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -16 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col gap-5"
                >
                  <div>
                    <div className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-soft">Sign in</div>
                    <h2 className="mt-2 text-[26px] font-bold tracking-[-0.035em]">What’s your email?</h2>
                    <p className="mt-1.5 text-[14.5px] text-muted">We’ll send you a 6-digit code.</p>
                  </div>
                  <label className="flex flex-col gap-2">
                    <span className="text-[13px] font-semibold">Email</span>
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoFocus
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-13 rounded-2xl bg-mist px-4 text-[16px] font-medium text-blue outline-none ring-pink/0 transition placeholder:text-soft focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--color-pink)]"
                    />
                  </label>
                  {error && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{error}</p>}
                  <Button type="submit" size="lg" disabled={busy}>
                    {busy ? "Sending code…" : "Send code"}
                  </Button>
                  <p className="text-[12.5px] leading-relaxed text-soft">
                    {handlers.mock
                      ? "Mock mode: no email is sent, and any 6-digit code works. Set NEXT_PUBLIC_PRIVY_APP_ID to use real email codes."
                      : "Codes are sent by Privy. By continuing you agree to create a wallet linked to this email."}
                  </p>
                </motion.form>
              )}

              {step === "code" && (
                <motion.div
                  key="code"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={{ duration: 0.25 }}
                  className="flex flex-col gap-5"
                >
                  <button
                    type="button"
                    onClick={() => { setStep("email"); setError(null); setDigits(Array(6).fill("")); }}
                    className="flex w-fit items-center gap-1 text-[13px] font-semibold text-muted hover:text-blue"
                  >
                    <BackIcon size={14} /> Change email
                  </button>
                  <div>
                    <h2 className="text-[26px] font-bold tracking-[-0.035em]">Enter your code</h2>
                    <p className="mt-1.5 text-[14.5px] text-muted">
                      Sent to <span className="font-semibold text-blue">{email}</span>
                    </p>
                  </div>
                  <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
                    {digits.map((d, i) => (
                      <input
                        key={i}
                        id={`code-${i}`}
                        ref={(el) => { inputs.current[i] = el; }}
                        value={d}
                        inputMode="numeric"
                        autoComplete={i === 0 ? "one-time-code" : "off"}
                        autoFocus={i === 0}
                        aria-label={`Digit ${i + 1}`}
                        maxLength={6}
                        onChange={(e) => setDigit(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                        }}
                        disabled={busy}
                        className={cx(
                          "nums h-14 w-full min-w-0 rounded-2xl bg-mist text-center text-[24px] font-bold text-blue outline-none transition",
                          "focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--color-pink)]",
                          d && "bg-pink/10",
                        )}
                      />
                    ))}
                  </div>
                  {error && <p className="text-[13.5px] font-medium text-pink-deep" role="alert">{error}</p>}
                  <Button size="lg" disabled={busy || digits.some((d) => !d)} onClick={() => submitCode(digits.join(""))}>
                    Verify and continue
                  </Button>
                  <button
                    type="button"
                    className="text-[13px] font-semibold text-muted hover:text-blue"
                    onClick={async () => {
                      setError(null);
                      try { await handlers.sendCode(email); setError("A new code is on its way."); } catch { setError("Couldn't resend. Try again."); }
                    }}
                  >
                    Resend code
                  </button>
                  {handlers.mock && <p className="text-[12.5px] text-soft">Mock mode: any 6 digits work.</p>}
                </motion.div>
              )}

              {step === "wallet" && <WalletMoment key="wallet" />}
            </AnimatePresence>
          </Card>
        </motion.div>
      </main>
    </div>
  );
}

function WalletMoment() {
  const steps = ["Email verified", "Creating your Stellar wallet", "Setting example spending limits"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((x) => Math.min(x + 1, steps.length)), 450);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-col items-center gap-6 py-6 text-center"
    >
      <div className="relative grid size-20 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full bg-pink/25"
          animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
        />
        <motion.span
          className="grid size-16 place-items-center rounded-full bg-blue text-white shadow-soft"
          animate={{ rotate: [0, 18, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <SparkIcon size={26} />
        </motion.span>
      </div>
      <ul className="flex w-full flex-col gap-2.5 text-left">
        {steps.map((s, k) => (
          <li key={s} className={cx("flex items-center gap-3 rounded-2xl px-4 py-3 text-[14.5px] font-semibold transition-colors", k < i ? "bg-mist text-blue" : "text-soft")}>
            <span className={cx("grid size-6 place-items-center rounded-full transition-colors", k < i ? "bg-pink text-white" : "bg-line text-transparent")}>
              <CheckIcon size={13} />
            </span>
            {s}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
