// GET /api/profile  — return the current user's profile row (or null)
// PUT /api/profile  — upsert the current user's profile (name/avatar/
//                     preferred colors/favorite themes)
//
// Both require a Bearer token (Supabase access token). RLS on the
// `profiles` table ensures a user can only read/write their own row.
// The row itself is auto-created at signup by the handle_new_user trigger,
// so PUT is an update in practice but we upsert defensively.

import { NextResponse } from "next/server";
import { bearerFromRequest, getServerSupabase } from "@/lib/supabase-server";

// Shape returned to the client. Mirrors the local Profile (minus the
// device-local fastAddGroupId, which is a UI preference we don't sync).
interface RemoteProfile {
  name: string;
  avatar: string;
  preferredColors: string[];
  favoriteThemes: string[];
  updatedAt: number; // epoch ms
}

export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServerSupabase(token);
  if (!sb) return NextResponse.json({ error: "sync_not_configured" }, { status: 503 });

  const { data: user, error: userErr } = await sb.auth.getUser();
  if (userErr || !user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await sb
    .from("profiles")
    .select("display_name, avatar, preferred_colors, favorite_themes, updated_at")
    .eq("id", user.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ profile: null });

  const profile: RemoteProfile = {
    name: data.display_name ?? "Planeswalker",
    avatar: data.avatar ?? "🧙",
    preferredColors: data.preferred_colors ?? [],
    favoriteThemes: data.favorite_themes ?? [],
    updatedAt: data.updated_at ? new Date(data.updated_at).getTime() : 0,
  };
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServerSupabase(token);
  if (!sb) return NextResponse.json({ error: "sync_not_configured" }, { status: 503 });

  const { data: user, error: userErr } = await sb.auth.getUser();
  if (userErr || !user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { profile?: Partial<RemoteProfile> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const p = body.profile;
  if (!p || typeof p.name !== "string" || typeof p.avatar !== "string") {
    return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
  }

  // Defensive caps so a malformed client can't write unbounded data.
  const name = p.name.slice(0, 40);
  const avatar = p.avatar.slice(0, 8);
  const preferred = Array.isArray(p.preferredColors) ? p.preferredColors.slice(0, 5) : [];
  const themes = Array.isArray(p.favoriteThemes) ? p.favoriteThemes.slice(0, 40) : [];

  const { error } = await sb.from("profiles").upsert(
    {
      id: user.user.id,
      display_name: name,
      avatar,
      preferred_colors: preferred,
      favorite_themes: themes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
