"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/Header";
import { AccountSummaryCard } from "@/components/AccountSummaryCard";
import { useDeckStore, AVATAR_OPTIONS, collectionStats } from "@/lib/store";
import { totalCards, deckPriceUsd, landCount } from "@/lib/analytics";
import { detectThemes } from "@/lib/recommend";

export default function ProfilePage() {
  const { profile, setProfile, decks, resetProfile } = useDeckStore();
  const collection = useDeckStore((s) => s.collection);
  const collStats = useMemo(() => collectionStats(collection), [collection]);
  const [name, setName] = useState(profile.name);

  const list = Object.values(decks);
  const totalDecks = list.length;
  const completeDecks = list.filter((d) => totalCards(d) === 100).length;
  const totalCardsAcross = list.reduce((s, d) => s + totalCards(d), 0);
  const totalPrice = list.reduce((s, d) => s + deckPriceUsd(d), 0);
  const totalLands = list.reduce((s, d) => s + landCount(d), 0);

  // Aggregate themes & colors used across decks
  const themeCount = new Map<string, number>();
  const colorCount = new Map<string, number>();
  for (const d of list) {
    const cmd = d.commanderId ? d.entries[d.commanderId]?.card : undefined;
    if (cmd) {
      for (const t of detectThemes(cmd)) themeCount.set(t, (themeCount.get(t) ?? 0) + 1);
      for (const c of cmd.color_identity) colorCount.set(c, (colorCount.get(c) ?? 0) + 1);
    }
  }
  const topThemes = Array.from(themeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topColors = Array.from(colorCount.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 space-y-6">
        <h1 className="font-display text-3xl bg-gradient-to-r from-sky-400 via-violet-400 to-violet-600 bg-clip-text text-transparent">
          Profile
        </h1>

        <section className="panel p-4 border border-violet-700/40 bg-violet-900/10">
          <div className="flex items-start gap-3 text-sm">
            <span aria-hidden className="text-violet-300 text-lg leading-none mt-0.5">ⓘ</span>
            <div className="flex-1 text-zinc-200">
              <div className="font-semibold text-violet-200">Local-only beta</div>
              <p className="text-xs text-zinc-300 mt-0.5 leading-snug">
                Your decks, collection, and profile are saved in this browser only. Clearing browser data or
                switching devices will lose them. Export your decks regularly (Builder → Export .txt /
                .md), or enable cloud sync below to back everything up.
              </p>
            </div>
          </div>
        </section>

        <section className="panel p-5 space-y-4">
          <h2 className="font-display text-lg text-violet-300">Identity</h2>
          <label className="block">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs text-zinc-400">Display name</span>
              <span className="text-[10px] text-zinc-500">
                {name.trim() !== profile.name ? "Unsaved" : "Saved"}
              </span>
            </div>
            <input
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const next = name.trim();
                if (next && next !== profile.name) setProfile({ name: next });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2"
            />
            <div className="text-[10px] text-zinc-500 mt-1">
              Saves automatically when you leave the field (Tab / Enter / click away).
            </div>
          </label>
          <div>
            <div className="text-xs text-zinc-400 mb-2">Avatar</div>
            <div className="flex flex-wrap gap-1">
              {AVATAR_OPTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => setProfile({ avatar: a })}
                  className={`text-2xl w-10 h-10 rounded border ${
                    profile.avatar === a ? "border-violet-500 bg-bg-raised" : "border-bg-border hover:bg-bg-raised"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-lg text-violet-300 mb-3">Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Decks" value={String(totalDecks)} />
            <Stat label="Tournament-legal" value={`${completeDecks}/${totalDecks}`} />
            <Stat label="Cards stored" value={String(totalCardsAcross)} />
            <Stat label="Total value" value={`$${totalPrice.toFixed(0)}`} />
            <Stat label="Lands" value={String(totalLands)} />
            <Stat label="Member since" value={new Date(profile.createdAt).toLocaleDateString()} />
          </div>
        </section>

        <section className="panel p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-display text-lg text-violet-300">Collection</h2>
            <Link href="/collection" className="text-xs text-violet-400 hover:underline underline-offset-2">
              Manage →
            </Link>
          </div>
          {collStats.uniqueCards === 0 ? (
            <p className="text-zinc-400 text-sm">
              No cards in your collection yet.{" "}
              <Link href="/collection" className="text-violet-400 hover:underline">
                Start tracking what you own
              </Link>{" "}
              to filter recommendations to cards you can build with today.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Unique cards" value={collStats.uniqueCards.toLocaleString()} />
              <Stat label="Total cards" value={collStats.totalCards.toLocaleString()} />
              <Stat
                label="Est. value"
                value={`$${collStats.estimatedValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              />
            </div>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-lg text-violet-300 mb-3">Color preferences</h2>
          {topColors.length === 0 ? (
            <p className="text-zinc-400 text-sm">Build a deck to see what colors you gravitate to.</p>
          ) : (
            <div className="flex gap-3">
              {(["W", "U", "B", "R", "G"] as const).map((c) => {
                const n = colorCount.get(c) ?? 0;
                return (
                  <div key={c} className="flex flex-col items-center">
                    <span className={`mana-symbol mana-${c}`} style={{ width: "2em", height: "2em", fontSize: "1em" }}>
                      {c}
                    </span>
                    <span className="text-xs text-zinc-400 mt-1">{n}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-display text-lg text-violet-300 mb-3">Favorite themes</h2>
          {topThemes.length === 0 ? (
            <p className="text-zinc-400 text-sm">As you build decks, your top mechanics will appear here.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {topThemes.map(([t, n]) => (
                <span key={t} className="chip text-violet-300 border-violet-700/40">
                  {t.startsWith("tribal:") ? `Tribal: ${t.slice(7)}` : t} <span className="text-zinc-400">×{n}</span>
                </span>
              ))}
            </div>
          )}
        </section>

        <AccountSummaryCard />

        <section className="panel p-5">
          <h2 className="font-display text-lg text-violet-300 mb-2">Local data</h2>
          <p className="text-xs text-zinc-400 mb-3">
            Decks and your profile are stored in this browser&rsquo;s localStorage. Clearing site data will erase anything that hasn&rsquo;t been synced to the cloud.
          </p>
          <button
            onClick={() => {
              if (confirm("Reset profile (decks will be kept)?")) resetProfile();
            }}
            className="btn btn-ghost"
          >
            Reset profile
          </button>
        </section>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-raised border border-bg-border rounded p-3">
      <div className="font-mono text-xl text-violet-300">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
    </div>
  );
}
