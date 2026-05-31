"use client";

import { useEffect, useRef, useState } from "react";
import { copyText, haptic } from "@/lib/feedback";

interface Props {
  text: string;
  className?: string;
  label?: React.ReactNode;
  copiedLabel?: React.ReactNode;
}

// Copy-to-clipboard button that *confirms* the action: it swaps to a
// "✓ Copied!" state for ~1.4s and fires a haptic tap. On mobile a silent
// clipboard write gives no feedback at all — this removes the "did that
// work?" doubt the user reported.
export function CopyButton({
  text,
  className = "",
  label = "Copy",
  copiedLabel = "✓ Copied!",
}: Props) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text);
        if (!ok) return;
        haptic();
        setCopied(true);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1400);
      }}
      aria-live="polite"
      className={`tap ${copied ? "tap-pop text-emerald-400" : ""} ${className}`}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
