"use client";

// Headless cloud-sync engine. Mounted once in the root layout so syncing runs
// on every page (not just wherever the CloudSync UI happens to be). It:
//   - reconciles decks + profile + collection on sign-in,
//   - debounce-pushes local edits while signed in,
//   - mirrors deletions (decks + collection entries) to the cloud,
//   - publishes status to the shared useSyncUi store and registers runSync
//     so a manual "Sync now" button can trigger it.
//
// When sync isn't configured or nobody's signed in, every path no-ops.

import { useCallback, useEffect } from "react";
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
  useSession,
} from "@/lib/session";
import type { Deck } from "@/lib/types";
import { registerRunSync, useSyncUi } from "@/lib/sync";
import { useAuth } from "@/lib/auth-state";

export function SyncEngine() {
  const session = useSession();
  const user = session.user;
  const setUi = useSyncUi((s) => s.set);

  // Mirror the session into the lightweight auth store so the Header and other
  // cheap consumers can read it without importing Supabase.
  const setAuth = useAuth((s) => s.setAuth);
  useEffect(() => {
    setAuth({ user: session.user, syncEnabled: session.syncEnabled, loading: session.loading });
  }, [session.user, session.syncEnabled, session.loading, setAuth]);

  const decks = useDeckStore((s) => s.decks);
  const profile = useDeckStore((s) => s.profile);
  const collection = useDeckStore((s) => s.collection);
  const collectionGroups = useDeckStore((s) => s.collectionGroups);

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

  const pullAndMergeDecks = useCallback(async () => {
    const remote = await fetchRemoteDecks();
    setUi({ cloudDeckCount: remote.length });
    if (remote.length > 0) {
      const state = useDeckStore.getState();
      const merged = { ...state.decks };
      for (const d of remote) {
        const local = merged[d.id];
        if (!local || (d.updatedAt ?? 0) > (local.updatedAt ?? 0)) merged[d.id] = d;
      }
      useDeckStore.setState({ decks: merged });
    }
  }, [setUi]);

  const pushAllDecks = useCallback(async () => {
    const list: Deck[] = Object.values(useDeckStore.getState().decks);
    for (const d of list) await pushDeck(d);
    setUi({ cloudDeckCount: list.length });
  }, [setUi]);

  const runSync = useCallback(async () => {
    setUi({ status: "syncing", error: null });
    try {
      await pullAndMergeDecks();
      await pushAllDecks();
      await reconcileProfile();
      await reconcileCollection();
      setUi({ status: "ok", lastSync: Date.now() });
    } catch (e) {
      setUi({ status: "error", error: e instanceof Error ? e.message : "Sync failed" });
    }
  }, [pullAndMergeDecks, pushAllDecks, reconcileProfile, reconcileCollection, setUi]);

  // Expose runSync for manual "Sync now" buttons.
  useEffect(() => {
    registerRunSync(runSync);
    return () => registerRunSync(null);
  }, [runSync]);

  // Reconcile on sign-in; reset status on sign-out.
  useEffect(() => {
    if (!user) {
      setUi({ status: "idle", lastSync: null, cloudDeckCount: null, error: null });
      return;
    }
    void runSync();
    // runSync is stable; only re-run when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Debounced deck push.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(async () => {
      try {
        setUi({ status: "syncing" });
        await pushAllDecks();
        setUi({ status: "ok", lastSync: Date.now() });
      } catch (e) {
        setUi({ status: "error", error: e instanceof Error ? e.message : "Sync failed" });
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [decks, user, pushAllDecks, setUi]);

  // Debounced profile push.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      pushProfile(useDeckStore.getState().profile).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, [profile, user]);

  // Debounced collection push.
  useEffect(() => {
    if (!user) return;
    const t = window.setTimeout(() => {
      const st = useDeckStore.getState();
      pushCollection(
        Object.values(st.collection ?? {}),
        Object.values(st.collectionGroups ?? {}),
      ).catch(() => {});
    }, 1500);
    return () => window.clearTimeout(t);
  }, [collection, collectionGroups, user]);

  // Mirror deletions (decks + collection entries) to the cloud while signed
  // in. Zustand subscription so we catch every removal, even ones that don't
  // re-render this component.
  useEffect(() => {
    if (!user) return;
    let prevDeckIds = Object.keys(useDeckStore.getState().decks);
    let prevCardIds = Object.keys(useDeckStore.getState().collection ?? {});
    const unsub = useDeckStore.subscribe((s) => {
      const deckIds = Object.keys(s.decks);
      for (const id of prevDeckIds.filter((i) => !deckIds.includes(i))) {
        deleteRemoteDeck(id).catch(() => {});
      }
      prevDeckIds = deckIds;

      const cardIds = Object.keys(s.collection ?? {});
      for (const id of prevCardIds.filter((i) => !cardIds.includes(i))) {
        deleteRemoteCollectionEntry(id).catch(() => {});
      }
      prevCardIds = cardIds;
    });
    return unsub;
  }, [user]);

  return null;
}
