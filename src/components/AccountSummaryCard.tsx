"use client";

// Compact account/sync summary for the /profile page. Links to the full
// /account page. Reflects three states: not configured, signed out, signed
// in (with live sync status). Keeps the heavy sync UI on /account so /profile
// stays focused on the player's MTG stats.

import Link from "next/link";
import { useAuth } from "@/lib/auth-state";
import { useSyncUi } from "@/lib/sync";

export function AccountSummaryCard() {
  const { user, syncEnabled, loading } = useAuth();
  const status = useSyncUi((s) => s.status);

  if (!syncEnabled) {
    return (
      <section className="panel p-5">
        <h2 className="font-display text-lg text-violet-300 mb-1">Account</h2>
        <p className="text-xs text-zinc-400">
          Cloud sync isn&rsquo;t configured for this deployment — your data lives in this browser only.
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-5 flex items-center justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <h2 className="font-display text-lg text-violet-300">Account &amp; sync</h2>
        {loading ? (
          <p className="text-xs text-zinc-500 mt-0.5">Checking session…</p>
        ) : user ? (
          <p className="text-xs text-zinc-400 mt-0.5">
            Signed in as <span className="text-violet-300 font-semibold">{user.email}</span>
            {status === "ok" && <span className="text-emerald-400"> · ✓ synced</span>}
            {status === "syncing" && <span className="text-violet-300"> · ⟳ syncing</span>}
            {status === "error" && <span className="text-red-400"> · ⚠ sync error</span>}
          </p>
        ) : (
          <p className="text-xs text-zinc-400 mt-0.5">
            Not signed in. Sync your decks &amp; collection across devices.
          </p>
        )}
      </div>
      <Link href="/account" className="btn btn-primary text-sm shrink-0">
        {user ? "Manage account" : "Sign in"}
      </Link>
    </section>
  );
}
