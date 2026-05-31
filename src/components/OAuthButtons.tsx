"use client";

// Social sign-in buttons (Google / Discord). Only renders providers listed in
// NEXT_PUBLIC_OAUTH_PROVIDERS, so a deployment that hasn't configured a
// provider in Supabase shows nothing rather than a button that errors.
//
// Rendered above the magic-link email form in CloudSync, with an "or" divider.

import { useState } from "react";
import { enabledOAuthProviders, signInWithProvider, type OAuthProvider } from "@/lib/session";
import { haptic } from "@/lib/feedback";

export function OAuthButtons() {
  const providers = enabledOAuthProviders();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (providers.length === 0) return null;

  return (
    <div className="space-y-2">
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          disabled={busy !== null}
          onClick={async () => {
            setBusy(p);
            setError(null);
            haptic();
            const { error } = await signInWithProvider(p);
            // On success the browser redirects to the provider; we only get
            // here on error.
            if (error) {
              setError(error);
              setBusy(null);
            }
          }}
          className="btn w-full justify-center border border-bg-border bg-bg-raised hover:bg-bg-border text-zinc-100"
        >
          {p === "google" ? <GoogleIcon /> : <DiscordIcon />}
          {busy === p ? "Redirecting…" : `Continue with ${LABEL[p]}`}
        </button>
      ))}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
        <span className="h-px flex-1 bg-bg-border" />
        or use email
        <span className="h-px flex-1 bg-bg-border" />
      </div>
    </div>
  );
}

const LABEL: Record<OAuthProvider, string> = { google: "Google", discord: "Discord" };

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden className="shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.02-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.98 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.02-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.94l3.02 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden className="shrink-0" fill="#5865F2">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.45 3c-.21.38-.46.9-.63 1.3a18.3 18.3 0 0 0-5.64 0A12.6 12.6 0 0 0 8.55 3 19.74 19.74 0 0 0 3.68 4.37C.55 9.04-.3 13.58.12 18.06a19.9 19.9 0 0 0 6.07 3.08c.49-.67.93-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.1 0c.17.14.34.27.5.4-.65.39-1.34.72-2.05.99.38.75.81 1.46 1.3 2.13a19.85 19.85 0 0 0 6.08-3.08c.5-5.19-.85-9.69-3.56-13.69zM8.02 15.33c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.95 2.42-2.15 2.42zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.94 2.42-2.15 2.42z" />
    </svg>
  );
}
