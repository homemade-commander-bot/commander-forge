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
