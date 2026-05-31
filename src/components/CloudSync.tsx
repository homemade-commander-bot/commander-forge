"use client";

// Cloud sync UI panel (the sync *engine* lives in <SyncEngine />, mounted
// app-wide in the layout — this component only renders state and the sign-in
// form). Three states:
//   1. Sync not configured (no env vars) → disabled note
//   2. Configured, signed out → email magic-link form
//   3. Configured, signed in → status, deck/collection counts, Sync now, sign out

import { useState } from "react";
import { useDeckStore } from "@/lib/store";
import { signInWithEmail, signOut, useSession } from "@/lib/session";
import { runSyncNow, useSyncUi, type SyncStatus } from "@/lib/sync";
import { OAuthButtons } from "./OAuthButtons";

export function CloudSync() {
  const { user, syncEnabled, loading } = useSession();
  const [email, setEmail] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [sendError, setSendError] = useState<string | null>(null);

  const status = useSyncUi((s) => s.status);
  const lastSync = useSyncUi((s) => s.lastSync);
  const syncError = useSyncUi((s) => s.error);
  const cloudCount = useSyncUi((s) => s.cloudDeckCount);

  const localCount = useDeckStore((s) => Object.keys(s.decks).length);
  const collectionCount = useDeckStore((s) => Object.keys(s.collection ?? {}).length);

  if (!syncEnabled) {
    return (
      <section className="panel p-5">
        <h2 className="font-display text-lg text-violet-300 mb-2">Cloud sync</h2>
        <p className="text-xs text-zinc-400">
          Cloud sync is not configured for this deployment. Your decks live in this browser only.
        </p>
        <p className="text-[10px] text-zinc-500 mt-2">
          (Self-hosting? Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable.)
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="panel p-5">
        <h2 className="font-display text-lg text-violet-300 mb-2">Cloud sync</h2>
        <p className="text-xs text-zinc-500">Checking session…</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="panel p-5 space-y-3">
        <h2 className="font-display text-lg text-violet-300">Sign in</h2>
        <p className="text-xs text-zinc-400">
          Sync your decks, collection, and profile across devices. No password — use a social login or a one-time email magic link.
        </p>
        <OAuthButtons />
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            setSendState("sending");
            setSendError(null);
            const { error } = await signInWithEmail(email.trim());
            if (error) {
              setSendState("error");
              setSendError(error);
            } else {
              setSendState("sent");
            }
          }}
          className="flex gap-2"
        >
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="flex-1 bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm"
          />
          <button type="submit" disabled={sendState === "sending"} className="btn btn-primary">
            {sendState === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {sendState === "sent" && (
          <p className="text-xs text-emerald-400">
            Check your email for the sign-in link. You can open it on any device — clicking it signs you in there.
          </p>
        )}
        {sendState === "error" && sendError && (
          <p className="text-xs text-red-400">{sendError}</p>
        )}
      </section>
    );
  }

  return (
    <section className="panel p-5 space-y-3">
      <h2 className="font-display text-lg text-violet-300">Cloud sync</h2>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm">
          Signed in as <span className="text-violet-300 font-semibold">{user.email}</span>
        </span>
        <SyncBadge status={status} lastSync={lastSync} />
        <button
          onClick={async () => {
            await signOut();
          }}
          className="btn btn-ghost text-xs ml-auto"
        >
          Sign out
        </button>
      </div>

      {/* At-a-glance + diagnostic readout. If cloud and device disagree,
          "Sync now" reconciles them. */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="chip border-bg-border">
          ☁ Cloud<span className="text-violet-300 font-semibold ml-1">{cloudCount ?? "—"}</span> decks
        </span>
        <span className="chip border-bg-border">
          💻 This device<span className="text-violet-300 font-semibold ml-1">{localCount}</span> decks
        </span>
        <span className="chip border-bg-border">
          🃏 Collection<span className="text-violet-300 font-semibold ml-1">{collectionCount}</span> cards
        </span>
        <button
          onClick={() => void runSyncNow()}
          disabled={status === "syncing"}
          className="btn btn-ghost text-xs"
        >
          {status === "syncing" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Decks, your profile, and your collection all sync. When the same item exists in two places, the most recently edited copy wins.
      </p>

      {status === "error" && syncError && (
        <p className="text-xs text-red-400">Last error: {syncError}</p>
      )}
    </section>
  );
}

function SyncBadge({ status, lastSync }: { status: SyncStatus; lastSync: number | null }) {
  if (status === "syncing") {
    return <span className="chip text-[10px] text-violet-300 border-violet-700/40">⟳ Syncing</span>;
  }
  if (status === "error") {
    return <span className="chip text-[10px] text-red-300 border-red-700/40">⚠ Sync error</span>;
  }
  if (status === "ok" && lastSync) {
    return (
      <span className="chip text-[10px] text-emerald-300 border-emerald-700/40">
        ✓ Synced {timeAgo(lastSync)}
      </span>
    );
  }
  return <span className="chip text-[10px] text-zinc-400 border-zinc-700">Idle</span>;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}
