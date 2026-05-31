// GET    /api/collection          — list the user's collection entries + groups
// POST   /api/collection          — bulk-upsert entries and/or groups
// DELETE /api/collection?cardId=X — delete a single entry (card fully removed)
//
// All require a Bearer token. RLS on collection_entries / collection_groups
// scopes every row to the owner. Entries store the full CollectionEntry as
// jsonb (keyed by card_id); groups store id + name.
//
// Bulk upsert (rather than one request per card like decks) because a
// collection can be hundreds of cards — a single round-trip keeps sync fast.

import { NextResponse } from "next/server";
import { bearerFromRequest, getServerSupabase } from "@/lib/supabase-server";
import type { CollectionEntry, CollectionGroup } from "@/lib/store";

export async function GET(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServerSupabase(token);
  if (!sb) return NextResponse.json({ error: "sync_not_configured" }, { status: 503 });

  const { data: user, error: userErr } = await sb.auth.getUser();
  if (userErr || !user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [entriesRes, groupsRes] = await Promise.all([
    sb.from("collection_entries").select("data").eq("user_id", user.user.id),
    sb.from("collection_groups").select("id, name, created_at").eq("user_id", user.user.id),
  ]);

  if (entriesRes.error) return NextResponse.json({ error: entriesRes.error.message }, { status: 500 });
  if (groupsRes.error) return NextResponse.json({ error: groupsRes.error.message }, { status: 500 });

  const entries = (entriesRes.data ?? []).map((row) => row.data as CollectionEntry);
  const groups: CollectionGroup[] = (groupsRes.data ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at ? new Date(row.created_at as string).getTime() : Date.now(),
  }));

  return NextResponse.json({ entries, groups });
}

export async function POST(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServerSupabase(token);
  if (!sb) return NextResponse.json({ error: "sync_not_configured" }, { status: 503 });

  const { data: user, error: userErr } = await sb.auth.getUser();
  if (userErr || !user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const uid = user.user.id;

  let body: { entries?: CollectionEntry[]; groups?: CollectionGroup[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const entries = Array.isArray(body.entries) ? body.entries : [];
  const groups = Array.isArray(body.groups) ? body.groups : [];

  // Validate shapes defensively before writing.
  const entryRows = entries
    .filter((e) => e && typeof e.cardId === "string" && e.groupQuantities && typeof e.groupQuantities === "object")
    .map((e) => ({
      card_id: e.cardId,
      user_id: uid,
      data: e,
      updated_at: new Date(e.updatedAt ?? Date.now()).toISOString(),
    }));

  const groupRows = groups
    .filter((g) => g && typeof g.id === "string" && typeof g.name === "string")
    .map((g) => ({
      id: g.id,
      user_id: uid,
      name: g.name.slice(0, 80),
    }));

  if (groupRows.length > 0) {
    const { error } = await sb.from("collection_groups").upsert(groupRows, { onConflict: "user_id,id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (entryRows.length > 0) {
    const { error } = await sb.from("collection_entries").upsert(entryRows, { onConflict: "user_id,card_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, entries: entryRows.length, groups: groupRows.length });
}

export async function DELETE(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sb = getServerSupabase(token);
  if (!sb) return NextResponse.json({ error: "sync_not_configured" }, { status: 503 });

  const { data: user, error: userErr } = await sb.auth.getUser();
  if (userErr || !user.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const cardId = new URL(req.url).searchParams.get("cardId");
  if (!cardId) return NextResponse.json({ error: "missing_cardId" }, { status: 400 });

  const { error } = await sb
    .from("collection_entries")
    .delete()
    .eq("user_id", user.user.id)
    .eq("card_id", cardId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
