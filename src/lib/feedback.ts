"use client";

// Small UX feedback helpers for touch interactions. All are best-effort and
// safe to call anywhere — they no-op when the underlying API is unavailable
// (e.g. navigator.vibrate is unsupported on iOS Safari, so on iOS we rely on
// the visual feedback — the press-scale and the transient "Copied!" state).

/** A short haptic tap (~10ms reads as a subtle "click" on supported devices). */
export function haptic(ms = 10): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(ms);
    }
  } catch {
    /* ignore — vibration is a progressive enhancement */
  }
}

/**
 * Copy text to the clipboard, returning true on success. Uses the async
 * Clipboard API where available, falling back to a hidden-textarea +
 * execCommand for older mobile browsers and non-secure contexts.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
