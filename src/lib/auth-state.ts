"use client";

// Lightweight auth-state mirror. The <SyncEngine /> (the single owner of the
// Supabase client) writes the current session here; cheap consumers like the
// Header and the profile's AccountSummaryCard read from it WITHOUT importing
// Supabase. That keeps @supabase/* off the critical-path bundle for every
// page — only the lazily-loaded SyncEngine (and the /account sign-in form)
// pull it in.

import { create } from "zustand";
import type { SessionUser } from "./session";

interface AuthState {
  user: SessionUser | null;
  syncEnabled: boolean;
  loading: boolean;
  setAuth: (patch: Partial<Pick<AuthState, "user" | "syncEnabled" | "loading">>) => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  syncEnabled: false,
  loading: true,
  setAuth: (patch) => set(patch),
}));
