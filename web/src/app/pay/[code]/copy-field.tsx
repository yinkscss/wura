"use client";

import { useState } from "react";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* the value is on screen; the payer can select it */
    }
  }
  return (
    <div>
      <div className="text-[12px] font-semibold text-muted">{label}</div>
      <div className="mt-1 flex items-center gap-2 rounded-xl bg-mist px-3 py-2.5">
        <code className="min-w-0 flex-1 break-all text-[13px] font-semibold">{value}</code>
        <button type="button" onClick={copy} className="shrink-0 text-[13px] font-semibold text-blue" aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
