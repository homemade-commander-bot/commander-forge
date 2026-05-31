"use client";

// Shared sync status, written by the headless <SyncEngine /> (mounted once in
// the root layout so sync runs on every page) and read by any UI that wants
// to show it (the CloudSync panel, the header indicator, the profile card).
//
// Keeping this separate from the deck store means the sync engine and its UI
// can live in different parts of the tree without prop-drilling.

import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "ok" | "error";

interface SyncUiState {
  status: SyncStatus;
  lastSync: number | null;
  error: string | null;
  cloudDeckCount: number | null;
  set: (patch: Partial<Omit<SyncUiState, "set">>) => void;
}

export const useSyncUi = create<SyncUiState>((set) => ({
  status: "idle",
  lastSync: null,
  error: null,
  cloudDeckCount: null,
  set: (patch) => set(patch),
}));

// <SyncEngine /> registers its runSync here so a "Sync now" button anywhere
// can trigger a manual reconcile without prop-drilling.
let _runSync: (() => Promise<void>) | null = null;

export function registerRunSync(fn: (() => Promise<void>) | null): void {
  _runSync = fn;
}

export function runSyncNow(): Promise<void> {
  return _runSync ? _runSync() : Promise.resolve();
}
