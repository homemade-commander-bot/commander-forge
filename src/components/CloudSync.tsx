"use client";

// Optional cloud sync UI. Renders one of three states:
//   1. Sync not configured (no env vars) → small disabled note
//   2. Sync configured, signed out → email field + magic-link button
//   3. Sync configured, signed in → email + sign-out + sync status
//
// The component is purely additive — the app works fine without it.

import { useCallback, useEffect, useState } from "react";
import { useDeckStore } from "@/lib/store";
import {
  deleteRemoteCollectionEntry,
  deleteRemoteDeck,
  fetchRemoteCollection,
  fetchRemoteDecks,
  fetchRemoteProfile,
  pushCollection,
  pushDeck,
  pushProfile,
  remoteProfileWins,
  signInWithEmail,
  signOut,
  useSession,
} from "@/lib/session";
import type { Deck } from "@/lib/types";

type SyncStatus = "idle" | "syncing" | "ok" | "error";

export function CloudSync() {
  const { user, syncEnabled, loading } = useSession();
  const [email, setEmail] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [cloudCount, setCloudCount] = useState<number | null>(null);

  const decks = useDeckStore((s) => s.decks);
  const localCount = Object.keys(decks).length;
  const profile = useDeckStore((s) => s.profile);
  const collection = useDeckStore((s) => s.collection);
  const collectionGroups = useDeckStore((s) => s.collectionGroups);
  const collectionCount = Object.keys(collection ?? {}).length;

  // Reconcile the profile (name/avatar/colors/themes) with the cloud. A
  // customized profile beats a default one; otherwise newest-edit wins.
  // Applying a remote win uses setState directly (not setProfile) so we keep
  // the remote updatedAt instead of stamping "now".
  const reconcileProfile = useCallback(async () => {
    const remote = await fetchRemoteProfile();
    const local = useDeckStore.getState().profile;
    if (remote && remoteProfileWins(local, remote)) {
      useDeckStore.setState((s) => ({
        profile: {
          ...s.profile,
          name: remote.name,
          avatar: remote.avatar,
          preferredColors: remote.preferredColors,
          favoriteThemes: remote.favoriteThemes,
          updatedAt: remote.updatedAt,
        },
      }));
    } else {
      await pushProfile(local);
    }
  }, []);

  // Reconcile the collection: pull cloud entries/groups, merge into local
  // (entries last-write-wins by updatedAt; groups union by id), then push the
  // merged set back so the cloud holds everything this device knows.
  const reconcileCollection = useCallback(async () => {
    const remote = await fetchRemoteCollection();
    const state = useDeckStore.getState();
    const mergedCollection = { ...(state.collection ?? {}) };
    for (const re of remote.entries) {
      const local = mergedCollection[re.cardId];
      if (!local || (re.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
        mergedCollection[re.cardId] = re;
      }
    }
    const mergedGroups = { ...(state.collectionGroups ?? {}) };
    for (const rg of remote.groups) {
      if (!mergedGroups[rg.id]) mergedGroups[rg.id] = rg;
    }
    useDeckStore.setState({ collection: mergedCollection, collectionGroups: mergedGroups });
    await pushCollection(Object.values(mergedCollection), Object.values(mergedGroups));
  }, []);

  // Pull cloud decks and merge into local (last-write-wins by updatedAt),
  // recording how many decks the cloud holds for the diagnostic readout.
  const pullAndMerge = useCallback(async () => {
    const remote = await fetchRemoteDecks();
    setCloudCount(remote.length);
    if (remote.length > 0) {
      const state = useDeckStore.getState();
      const merged = { ...state.decks };
      for (const d of remote) {
        const local = merged[d.id];
        if (!local || (d.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
          merged[d.id] = d;
        }
      }
      useDeckStore.setState({ decks: merged });
    }
  }, []);

  // Push every local deck up to the cloud.
  const pushAll = useCallback(async () => {
    const list: Deck[] = Object.values(useDeckStore.getState().decks);
    for (const d of list) await pushDeck(d);
    setCloudCount(list.length);
  }, []);

  // Full reconcile: pull then push, so a freshly signed-in device both
  // receives the cloud's decks and contributes its own. Used by the sign-in
  // effect and the manual "Sync now" button.
  const runSync = useCallback(async () => {
    setErrorMsg(null);
    setSyncStatus("syncing");
    try {
      await pullAndMerge();
      await pushAll();
      await reconcileProfile();
      await reconcileCollection();
      setSyncStatus("ok");
      setLastSync(Date.now());
    } catch (e) {
      setSyncStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Sync failed");
    }
  }, [pullAndMerge, pushAll, reconcileProfile, reconcileCollection]);

  // On sign-in, reconcile both directions once.
  useEffect(() => {
    if (!user) return;
    void runSync();
    // runSync is stable (useCallback); intentionally only re-run on sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Push local edits to the cloud (debounced) while signed in.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(async () => {
      try {
        setSyncStatus("syncing");
        await pushAll();
        setSyncStatus("ok");
        setLastSync(Date.now());
      } catch (e) {
        setSyncStatus("error");
        setErrorMsg(e instanceof Error ? e.message : "Sync failed");
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [decks, user, pushAll]);

  // Push profile edits (name/avatar/colors/themes) to the cloud, debounced.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      pushProfile(useDeckStore.getState().profile).catch(() => {
        // Best-effort; the next sign-in reconcile will catch it up.
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [profile, user]);

  // Push collection edits (entries + groups) to the cloud, debounced.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      const st = useDeckStore.getState();
      pushCollection(Object.values(st.collection ?? {}), Object.values(st.collectionGroups ?? {})).catch(() => {
        // Best-effort; next sign-in reconcile catches it up.
      });
    }, 1500);
    return () => window.clearTimeout(t);
  }, [collection, collectionGroups, user]);

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
        <h2 className="font-display text-lg text-violet-300">Cloud sync</h2>
        <p className="text-xs text-zinc-400">
          Optional. Sign in with your email to sync decks across devices. We&rsquo;ll send you a one-time magic link — no password.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            setSendState("sending");
            setErrorMsg(null);
            const { error } = await signInWithEmail(email.trim());
            if (error) {
              setSendState("error");
              setErrorMsg(error);
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
          <button
            type="submit"
            disabled={sendState === "sending"}
            className="btn btn-primary"
          >
            {sendState === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>
        {sendState === "sent" && (
          <p className="text-xs text-emerald-400">
            Check your email for the sign-in link. You can close this tab — clicking the link signs you in.
          </p>
        )}
        {sendState === "error" && errorMsg && (
          <p className="text-xs text-red-400">{errorMsg}</p>
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
        <SyncBadge status={syncStatus} lastSync={lastSync} />
        <button
          onClick={async () => {
            await signOut();
            setSyncStatus("idle");
            setLastSync(null);
            setCloudCount(null);
          }}
          className="btn btn-ghost text-xs ml-auto"
        >
          Sign out
        </button>
      </div>

      {/* Diagnostic + at-a-glance readout: how many decks live in the cloud
          vs on this device. If these disagree, "Sync now" reconciles them. */}
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
          onClick={() => void runSync()}
          disabled={syncStatus === "syncing"}
          className="btn btn-ghost text-xs"
        >
          {syncStatus === "syncing" ? "Syncing…" : "Sync now"}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Decks, your profile, and your collection all sync. When the same item exists in two places, the most recently edited copy wins.
      </p>

      {syncStatus === "error" && errorMsg && (
        <p className="text-xs text-red-400">Last error: {errorMsg}</p>
      )}
      <DeleteDeckSyncControl />
      <DeleteCollectionSyncControl />
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

// Listens for deck deletions while signed in and mirrors them to the cloud.
// Subscribed via Zustand instead of useEffect so we catch every change,
// including ones that don't shrink the decks map (no-op deletes).
function DeleteDeckSyncControl() {
  useEffect(() => {
    let prevIds = Object.keys(useDeckStore.getState().decks);
    const unsub = useDeckStore.subscribe((s) => {
      const ids = Object.keys(s.decks);
      const removed = prevIds.filter((id) => !ids.includes(id));
      prevIds = ids;
      for (const id of removed) {
        deleteRemoteDeck(id).catch(() => {
          // Swallow — best-effort cleanup; orphaned rows are harmless.
        });
      }
    });
    return unsub;
  }, []);
  return null;
}

// Mirrors deletions of collection entries (a card fully removed locally) to
// the cloud, so removing a card on one device removes it everywhere.
function DeleteCollectionSyncControl() {
  useEffect(() => {
    let prevIds = Object.keys(useDeckStore.getState().collection ?? {});
    const unsub = useDeckStore.subscribe((s) => {
      const ids = Object.keys(s.collection ?? {});
      const removed = prevIds.filter((id) => !ids.includes(id));
      prevIds = ids;
      for (const id of removed) {
        deleteRemoteCollectionEntry(id).catch(() => {
          // Best-effort cleanup; orphaned rows are harmless.
        });
      }
    });
    return unsub;
  }, []);
  return null;
}
