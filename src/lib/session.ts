"use client";

// Lightweight client-side session manager built on the optional Supabase
// client. Designed so that:
//   - If Supabase is not configured, all functions become no-ops and
//     `useSession()` returns { user: null, syncEnabled: false }.
//   - The app keeps working without ever requiring an account; sync is
//     a strictly additive feature.

import { useEffect, useState } from "react";
import { getSupabase, isSyncEnabled } from "./supabase";
import type { Deck } from "./types";
import type { Profile } from "./store";

// The subset of the profile that syncs to the cloud. fastAddGroupId is a
// device-local UI preference and is intentionally excluded.
export interface RemoteProfile {
  name: string;
  avatar: string;
  preferredColors: string[];
  favoriteThemes: string[];
  updatedAt: number;
}

export interface SessionUser {
  id: string;
  email: string | null;
}

export interface Session {
  user: SessionUser | null;
  syncEnabled: boolean;
  loading: boolean;
}

export function useSession(): Session {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const syncEnabled = isSyncEnabled();

  useEffect(() => {
    if (!syncEnabled) {
      setLoading(false);
      return;
    }
    const sb = getSupabase();
    if (!sb) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    sb.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? null } : null);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [syncEnabled]);

  return { user, syncEnabled, loading };
}

export async function signInWithEmail(email: string): Promise<{ error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { error: "Sync is not configured." };
  // Magic links land on /auth/callback (a client page) which confirms the
  // session parsed from the URL fragment and shows success/error feedback.
  // Keep this path in Supabase → Auth → URL Configuration → Redirect URLs.
  const redirectTo =
    typeof window !== "undefined" ? `${window.location.origin}/auth/callback` : undefined;
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo },
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sync is not configured.");
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return fetch(path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export async function fetchRemoteDecks(): Promise<Deck[]> {
  const res = await authFetch("/api/decks");
  if (!res.ok) throw new Error(`Failed to fetch decks (${res.status})`);
  const json = (await res.json()) as { decks: Deck[] };
  return json.decks;
}

export async function pushDeck(deck: Deck): Promise<void> {
  const res = await authFetch("/api/decks", {
    method: "POST",
    body: JSON.stringify({ deck }),
  });
  if (!res.ok) throw new Error(`Failed to save deck (${res.status})`);
}

export async function deleteRemoteDeck(deckId: string): Promise<void> {
  const res = await authFetch(`/api/decks/${encodeURIComponent(deckId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete deck (${res.status})`);
}

// ---- profile sync --------------------------------------------------------

export async function fetchRemoteProfile(): Promise<RemoteProfile | null> {
  const res = await authFetch("/api/profile");
  if (!res.ok) throw new Error(`Failed to fetch profile (${res.status})`);
  const json = (await res.json()) as { profile: RemoteProfile | null };
  return json.profile;
}

export async function pushProfile(profile: Profile): Promise<void> {
  const payload: RemoteProfile = {
    name: profile.name,
    avatar: profile.avatar,
    preferredColors: profile.preferredColors ?? [],
    favoriteThemes: profile.favoriteThemes ?? [],
    updatedAt: profile.updatedAt ?? 0,
  };
  const res = await authFetch("/api/profile", {
    method: "PUT",
    body: JSON.stringify({ profile: payload }),
  });
  if (!res.ok) throw new Error(`Failed to save profile (${res.status})`);
}

// Decide whether the cloud profile should replace the local one. A
// *customized* profile always beats a still-default one (so a fresh device
// adopts the cloud identity instead of stomping it with "Planeswalker"); if
// both are customized (or both default) the most recently edited wins.
const DEFAULT_NAME = "Planeswalker";
const DEFAULT_AVATAR = "🧙";

export function remoteProfileWins(local: Profile, remote: RemoteProfile): boolean {
  const localCustom = local.name !== DEFAULT_NAME || local.avatar !== DEFAULT_AVATAR;
  const remoteCustom = remote.name !== DEFAULT_NAME || remote.avatar !== DEFAULT_AVATAR;
  if (remoteCustom && !localCustom) return true;
  if (localCustom && !remoteCustom) return false;
  return (remote.updatedAt ?? 0) > (local.updatedAt ?? 0);
}
