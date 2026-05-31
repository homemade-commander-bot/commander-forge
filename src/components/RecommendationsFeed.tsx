"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { commanderRecommendations, detectThemes, type Recommendation } from "@/lib/recommend";
import { ownedCardNames, useDeckStore } from "@/lib/store";
import type { Card, Deck } from "@/lib/types";
import { ManaCost, ColorIdentityPips } from "./ManaCost";
import { frontImage, safeHttpUrl } from "@/lib/scryfall";
import { CardHoverLayer, hoverProps, useCardHover, type CardHover } from "./CardHoverPreview";
import { dragSourceProps } from "@/lib/dnd";
import { haptic } from "@/lib/feedback";

type SortMode = "rank" | "synergy" | "cmc" | "price";

interface Props {
  deck: Deck;
  onInspect: (c: Card) => void;
}

export function RecommendationsFeed({ deck, onInspect }: Props) {
  const { addCard, fastAddToCollection } = useDeckStore();
  const fastAddGroupId = useDeckStore((s) => s.profile.fastAddGroupId);
  const collectionGroups = useDeckStore((s) => s.collectionGroups);
  const fastAddGroupName =
    collectionGroups?.[fastAddGroupId ?? ""]?.name ?? "Collection";
  const commander = deck.commanderId ? deck.entries[deck.commanderId]?.card : undefined;
  const partner = deck.partnerId ? deck.entries[deck.partnerId]?.card : undefined;
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [themes, setThemes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<string>("All");
  const [source, setSource] = useState<"all" | "edhrec" | "theme" | "staple">("all");
  const [sort, setSort] = useState<SortMode>("rank");
  const [maxCmc, setMaxCmc] = useState<number>(20);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [ownedOnly, setOwnedOnly] = useState(false);
  const collection = useDeckStore((s) => s.collection);
  const ownedNames = useMemo(() => ownedCardNames(collection), [collection]);
  const hover = useCardHover();

  // Load recommendations whenever the commander changes. We render
  // progressively: EDHREC results appear within a few seconds via the
  // onStage callback, then theme + staple results stream in, rather
  // than the whole page staying blank until everything resolves.
  useEffect(() => {
    if (!commander) {
      setRecs([]);
      setThemes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRecs([]);
    setThemes(detectThemes(commander));
    // shuffle: false — the feed has its own sort dropdown; we want stable
    // rank order by default so users can scroll a predictable list.
    commanderRecommendations(commander, partner, {
      max: 400,
      shuffle: false,
      onStage: (partial) => {
        // Guard against a stale commander's results landing after the
        // user switched commanders mid-load.
        if (!cancelled) setRecs(partial);
      },
    })
      .then((r) => {
        if (!cancelled) setRecs(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load recommendations");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [commander?.id, partner?.id]);

  function flashCard(id: string) {
    setFlash((s) => new Set(s).add(id));
    setTimeout(() => {
      setFlash((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }, 600);
  }

  function add(r: Recommendation) {
    addCard(deck.id, r.card);
    flashCard(r.card.id);
    haptic();
  }

  // Filter & sort
  const filtered = useMemo(() => {
    let out = recs.filter((r) => !deck.entries[r.card.id]);
    if (section !== "All") out = out.filter((r) => r.section === section);
    if (source !== "all") out = out.filter((r) => r.source === source);
    if (ownedOnly) out = out.filter((r) => ownedNames.has(r.card.name));
    out = out.filter((r) => r.card.cmc <= maxCmc);
    if (sort === "synergy") out = [...out].sort((a, b) => (b.synergy ?? -1) - (a.synergy ?? -1));
    else if (sort === "cmc") out = [...out].sort((a, b) => a.card.cmc - b.card.cmc);
    else if (sort === "price")
      out = [...out].sort((a, b) => parseFloat(b.card.prices.usd ?? "0") - parseFloat(a.card.prices.usd ?? "0"));
    else out = [...out].sort((a, b) => a.rank - b.rank);
    return out;
  }, [recs, deck.entries, section, source, sort, maxCmc, ownedOnly, ownedNames]);

  const sections = useMemo(() => {
    const set = new Set<string>(recs.map((r) => r.section));
    return ["All", ...Array.from(set)];
  }, [recs]);

  if (!commander) {
    return (
      <div className="panel p-12 text-center">
        <div className="text-5xl mb-3">🜂</div>
        <h3 className="font-display text-xl text-violet-300 mb-1">Pick a commander to start your feed</h3>
        <p className="text-zinc-400 text-sm">
          The recommendation feed pulls EDHREC top cards, theme synergies, and format staples within your commander&rsquo;s
          color identity.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="panel p-3 mb-3 sticky top-0 z-10">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">For</span>
            <span className="font-semibold text-violet-300">{commander.name}</span>
            {partner && (
              <>
                <span className="text-zinc-500">+</span>
                <span className="font-semibold text-violet-300">{partner.name}</span>
              </>
            )}
          </div>
          {loading && (
            <span className="text-xs text-violet-400 ml-2 inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
              {recs.length === 0
                ? "Pulling EDHREC + Scryfall…"
                : `Loading more… (${recs.length} so far)`}
            </span>
          )}
          <span className="text-xs text-zinc-500 ml-auto">{filtered.length} suggestions</span>
        </div>

        {themes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {themes.map((t) => (
              <span key={t} className="chip text-violet-300 border-violet-700/40">
                {t.startsWith("tribal:") ? `Tribal: ${t.slice(7)}` : t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className="bg-bg-raised border border-bg-border rounded px-2 py-1"
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            {(["all", "edhrec", "theme", "staple"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={`px-2 py-1 rounded ${
                  source === s ? "bg-violet-600 text-white" : "bg-bg-raised text-zinc-300 hover:bg-bg-border"
                }`}
              >
                {s === "all" ? "All sources" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
            className="bg-bg-raised border border-bg-border rounded px-2 py-1"
          >
            <option value="rank">Sort: Recommended</option>
            <option value="synergy">Sort: Synergy</option>
            <option value="cmc">Sort: Mana value</option>
            <option value="price">Sort: Price (high → low)</option>
          </select>
          <label className="flex items-center gap-1">
            <span className="text-zinc-400">Max MV</span>
            <input
              type="range"
              min={0}
              max={20}
              value={maxCmc}
              onChange={(e) => setMaxCmc(Number(e.target.value))}
              className="accent-violet-500"
            />
            <span className="text-zinc-300 w-6 text-right">{maxCmc}</span>
          </label>
          <label
            className="flex items-center gap-1 text-xs text-zinc-300"
            title="Only show cards you own at least one copy of"
          >
            <input
              type="checkbox"
              checked={ownedOnly}
              onChange={(e) => setOwnedOnly(e.target.checked)}
              className="accent-violet-500"
            />
            Owned only
          </label>
        </div>
      </div>

      {error && <div className="panel p-4 text-red-400 text-sm mb-3">{error}</div>}

      <div className="flex-1 overflow-y-auto pr-2">
        {section === "All" ? (
          <GroupedFeed
            recs={filtered}
            onAdd={add}
            onInspect={onInspect}
            flash={flash}
            hover={hover}
            onFastAddToCollection={fastAddToCollection}
            fastAddGroupName={fastAddGroupName}
            ownedNames={ownedNames}
          />
        ) : (
          <FeedGrid
            recs={filtered}
            onAdd={add}
            onInspect={onInspect}
            flash={flash}
            hover={hover}
            onFastAddToCollection={fastAddToCollection}
            fastAddGroupName={fastAddGroupName}
            ownedNames={ownedNames}
          />
        )}
        {/* Skeleton grid on the first load, before any results arrive,
            so impatient users see structured "this is working" feedback
            rather than a blank panel. */}
        {loading && recs.length === 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 15 }).map((_, i) => (
              <div key={i} className="panel overflow-hidden animate-pulse">
                <div className="aspect-[5/7] bg-bg-raised" />
                <div className="p-2 space-y-1">
                  <div className="h-3 bg-bg-raised rounded w-3/4" />
                  <div className="h-2 bg-bg-raised rounded w-1/2" />
                  <div className="h-7 bg-bg-raised rounded mt-1" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-zinc-500 py-12 text-sm">
            Nothing left in this filter — try widening the source or section.
          </div>
        )}
      </div>
      <CardHoverLayer hover={hover} />
    </div>
  );
}

interface FeedRowProps {
  recs: Recommendation[];
  onAdd: (r: Recommendation) => void;
  onInspect: (c: Card) => void;
  flash: Set<string>;
  hover: CardHover;
  onFastAddToCollection: (card: Card) => void;
  fastAddGroupName: string;
  ownedNames: Set<string>;
}

function GroupedFeed(props: FeedRowProps) {
  const { recs } = props;
  const groups = new Map<string, Recommendation[]>();
  for (const r of recs) {
    if (!groups.has(r.section)) groups.set(r.section, []);
    groups.get(r.section)!.push(r);
  }
  return (
    <div className="space-y-6 pb-12">
      {Array.from(groups.entries()).map(([sec, items]) => (
        <section key={sec}>
          <div className="sticky top-0 z-10 bg-bg-base/80 backdrop-blur py-2 mb-2 border-b border-bg-border">
            <h3 className="font-display text-lg text-violet-300">
              {sec} <span className="text-zinc-500 text-sm font-sans ml-1">{items.length}</span>
            </h3>
          </div>
          <FeedGrid {...props} recs={items} />
        </section>
      ))}
    </div>
  );
}

function FeedGrid({ recs, onAdd, onInspect, flash, hover, onFastAddToCollection, fastAddGroupName, ownedNames }: FeedRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {recs.map((r) => (
        <FeedCard
          key={r.card.id}
          r={r}
          onAdd={onAdd}
          onInspect={onInspect}
          flashing={flash.has(r.card.id)}
          hover={hover}
          onFastAddToCollection={onFastAddToCollection}
          fastAddGroupName={fastAddGroupName}
          owned={ownedNames.has(r.card.name)}
        />
      ))}
    </div>
  );
}

function FeedCard({
  r,
  onAdd,
  onInspect,
  flashing,
  hover,
  onFastAddToCollection,
  fastAddGroupName,
  owned,
}: {
  r: Recommendation;
  onAdd: (r: Recommendation) => void;
  onInspect: (c: Card) => void;
  flashing: boolean;
  hover: CardHover;
  onFastAddToCollection: (card: Card) => void;
  fastAddGroupName: string;
  owned: boolean;
}) {
  const img = frontImage(r.card, "normal");
  return (
    <article
      {...dragSourceProps(r.card)}
      {...hoverProps(r.card, hover)}
      className={`feed-card panel overflow-hidden flex flex-col cursor-grab active:cursor-grabbing ${flashing ? "added-flash" : ""}`}
      title="Drag onto your decklist or click + Add to deck"
    >
      <button onClick={() => onInspect(r.card)} className="block w-full">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={r.card.name} className="w-full block pointer-events-none" loading="lazy" draggable={false} />
        ) : (
          <div className="aspect-[5/7] bg-bg-raised flex items-center justify-center text-xs p-2 text-center">
            {r.card.name}
          </div>
        )}
      </button>
      <div className="p-2 text-xs space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold truncate" title={r.card.name}>{r.card.name}</span>
          <ManaCost cost={r.card.mana_cost} />
        </div>
        <div className="flex items-center justify-between gap-1 text-[10px]">
          <span className="text-zinc-400 truncate" title={r.reason}>{r.reason}</span>
          <ColorIdentityPips colors={r.card.color_identity} />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span className="truncate">{r.card.type_line.split(" — ")[0]}</span>
        </div>
        {/* Primary action: full-width so the label never truncates. */}
        <button
          onClick={() => onAdd(r)}
          className="btn btn-primary text-xs w-full justify-center mt-1"
          title="Add this card to your active deck"
        >
          + Add to deck
        </button>

        {/* Secondary actions: explicit text on each so the function is
            unambiguous. Owned state changes both label and color. */}
        <div className="flex gap-1">
          <button
            onClick={() => onFastAddToCollection(r.card)}
            className={`text-[11px] px-2 py-1 rounded border transition flex-1 flex items-center justify-center gap-1 ${
              owned
                ? "border-violet-700/40 bg-violet-900/30 text-violet-200 hover:bg-violet-900/50"
                : "border-bg-border bg-bg-raised text-zinc-300 hover:bg-bg-border hover:text-violet-300"
            }`}
            title={
              owned
                ? `Already in ${fastAddGroupName} — click to add another copy`
                : `Add 1 copy to ${fastAddGroupName}`
            }
          >
            <span aria-hidden>{owned ? "✓" : "+"}</span>
            <span>{owned ? "Owned" : "Collect"}</span>
          </button>
          {safeHttpUrl(r.card.purchase_uris?.tcgplayer) && (
            <a
              href={safeHttpUrl(r.card.purchase_uris?.tcgplayer)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] px-2 py-1 rounded border border-bg-border bg-bg-raised text-zinc-300 hover:bg-bg-border hover:text-emerald-300 flex items-center justify-center gap-1"
              title="Buy this printing on TCGplayer"
            >
              <span aria-hidden>$</span>
              <span>{r.card.prices.usd ? `${parseFloat(r.card.prices.usd).toFixed(2)}` : "Buy"}</span>
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
