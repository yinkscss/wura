import Link from "next/link";
import { cx } from "@/components/ui";

/**
 * The plain wording that goes on every screen that moves money (M9). One place,
 * so the words can't drift. Never says "licensed", and never names a partner as
 * agreed (D6): it says "through a partner" until that partner confirms in writing.
 */
const WORDS = {
  naira:
    "Naira in and out goes through a partner, not through Wura. Wura doesn't hold your money and isn't a bank. The partner's own terms and checks apply, and it can be slow or refuse a transfer.",
  swap:
    "Swaps run on the public Stellar market, not through a bank. Prices move: you get at least the minimum shown, or nothing is swapped. Wura doesn't hold your money.",
  send:
    "Payments on Stellar can't be undone. Check the address and the memo before you approve.",
} as const;

export function PartnerNote({ kind, className }: { kind: keyof typeof WORDS; className?: string }) {
  return (
    <p className={cx("text-[12.5px] leading-relaxed text-soft", className)}>
      {WORDS[kind]}{" "}
      <Link href="/terms" className="font-semibold underline underline-offset-2 hover:text-blue">
        Terms and risks
      </Link>
    </p>
  );
}
