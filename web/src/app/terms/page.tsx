import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms and risks" };

/**
 * Plain-language terms for the invite-only beta (M9). DRAFT: written by the
 * build team, not by a lawyer. D6 says nobody outside the two builders uses
 * real money until LINK answers in writing and a lawyer has reviewed this page.
 * Nothing here says Wura or any partner is licensed.
 */
const sections: Array<{ h: string; p: string[] }> = [
  {
    h: "What Wura is",
    p: [
      "Wura is an app that helps you hold and move naira (NGNC) and dollars (USDC) on the Stellar network, from a wallet that is yours. You approve every payment and swap yourself.",
      "Wura is not a bank and doesn't hold your money. Nobody at Wura can move your money without your approval. If Wura went away, your wallet and what's in it would still be yours.",
    ],
  },
  {
    h: "Naira in and out goes through a partner",
    p: [
      "Turning naira in a bank account into NGNC or USDC, and back, is done by a partner, not by Wura. You'll be sent to the partner's own page, and its terms, identity checks, limits, fees and timings apply.",
      "Wura doesn't see or keep your NIN or BVN. A partner can be slow, can refuse a transfer, and can change or stop its service. If that happens, your money is with the partner until it finishes or refunds you, and Wura can't speed that up.",
    ],
  },
  {
    h: "Swaps and prices",
    p: [
      "Swaps run on the public Stellar market. Before you approve, you see the price and the least you will receive. If the price moves below that before the swap lands, nothing is swapped.",
      "The market price can be worse than the bank or street rate, sometimes by a lot, especially for naira to dollars. Wura shows how far a price is from the market rate and refuses swaps that are too far below it. That is a safety check, not a promise of a good price.",
    ],
  },
  {
    h: "Payments can't be undone",
    p: [
      "A payment on Stellar is final. Check the address, the asset and any memo before you approve. Wura can't reverse a payment or get it back for you.",
      "Payment links show a request for money. Anyone with the link can pay it. A link expires after seven days, and a payment that arrives late is shown but doesn't close the link.",
    ],
  },
  {
    h: "The beta and its limits",
    p: [
      "This is an invite-only beta with low limits per payment and per day. Limits can change. We can pause all money movement at any time, and when we do, nothing is sent until we turn it back on.",
      "Things can go wrong in a beta. Don't put in more than you can afford to lose while it's new.",
    ],
  },
  {
    h: "Network fees",
    p: [
      "Every Stellar transaction has a tiny network fee. Wura covers the small amount of XLM your wallet needs to get started. Partners and markets can charge their own fees, which are shown on their own pages or inside the price.",
    ],
  },
  {
    h: "Your data",
    p: [
      "We keep your email, your wallet address and a record of what you approved. We don't keep your NIN or BVN. Sign-in codes are sent by Privy, our sign-in provider.",
    ],
  },
  {
    h: "Contact",
    p: ["Questions or a problem with a payment: [contact address to be added before the beta opens]."],
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-4 py-12">
      <div>
        <Link href="/" className="text-[13px] font-semibold text-muted hover:text-blue">← Wura</Link>
        <h1 className="mt-4 text-[34px] font-bold leading-tight tracking-[-0.04em]">Terms and risks</h1>
      </div>
      {sections.map((s) => (
        <section key={s.h} className="flex flex-col gap-2">
          <h2 className="text-[18px] font-bold tracking-[-0.02em]">{s.h}</h2>
          {s.p.map((t) => (
            <p key={t} className="text-[15px] leading-relaxed text-muted">{t}</p>
          ))}
        </section>
      ))}
    </main>
  );
}
