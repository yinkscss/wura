import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { SparkIcon } from "./icons";

export function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

/** Placeholder wordmark: "Agent" + small "name TBD". */
export function Wordmark({ tone = "dark", href = "/" }: { tone?: "dark" | "light"; href?: string }) {
  const onBlue = tone === "dark";
  return (
    <Link href={href} className="group flex items-center gap-2.5" aria-label="Agent, home">
      <span
        className={cx(
          "grid size-8 place-items-center rounded-[9px] transition-transform duration-300 group-hover:rotate-[20deg]",
          onBlue ? "bg-white text-blue" : "bg-blue text-white",
        )}
      >
        <SparkIcon size={16} />
      </span>
      <span className={cx("text-[17px] font-bold leading-none tracking-[-0.03em]", onBlue ? "text-white" : "text-blue")}>
        Agent
      </span>
      <span
        className={cx(
          "ml-0.5 text-[9px] font-medium uppercase tracking-[0.08em]",
          onBlue ? "text-white/55" : "text-muted/60",
        )}
      >
        name TBD
      </span>
    </Link>
  );
}

type Variant = "pink" | "white" | "outline" | "outline-blue" | "blue" | "ghost";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  pink: "bg-pink text-white shadow-pink hover:bg-pink-hot",
  white: "bg-white text-blue-ink shadow-[0_8px_20px_rgba(0,0,0,0.12)] hover:bg-mist",
  outline: "bg-transparent text-white shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.9)] hover:bg-white/10",
  "outline-blue": "bg-white text-blue shadow-[inset_0_0_0_1.5px_rgba(8,49,141,0.22)] hover:shadow-[inset_0_0_0_1.5px_rgba(8,49,141,0.5)]",
  blue: "bg-blue text-white shadow-soft hover:bg-blue-mid",
  ghost: "bg-blue/[0.06] text-blue hover:bg-blue/10",
};
const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-[22px] text-sm",
  lg: "h-12 px-7 text-[15px]",
};

export function buttonClass(variant: Variant = "pink", size: Size = "md", extra?: string) {
  return cx(
    "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold leading-none tracking-[-0.01em] transition-[background,box-shadow,transform,opacity] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
    variants[variant],
    sizes[size],
    extra,
  );
}

export function Button({
  variant = "pink",
  size = "md",
  className,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = "pink",
  size = "md",
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-card bg-white shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function Pill({ tone = "blue", children, className }: { tone?: "blue" | "pink" | "pink-solid" | "white"; children: ReactNode; className?: string }) {
  const t = {
    blue: "bg-blue/[0.08] text-blue",
    pink: "bg-pink/20 text-pink-deep",
    "pink-solid": "bg-pink text-white",
    white: "bg-white/15 text-white",
  }[tone];
  return (
    <span className={cx("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold uppercase tracking-[0.05em]", t, className)}>
      {children}
    </span>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("text-[11.5px] font-semibold uppercase tracking-[0.12em] text-soft", className)}>{children}</div>
  );
}
