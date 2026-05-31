"use client";

// The /collection page: lets the user browse, filter, search, and edit
// their card collection across one or more user-defined groups
// (sub-collections). Filters are local except for the Scryfall-syntax
// search, which goes through Scryfall's /cards/search endpoint and then
// intersects with the collection by card.id (so the user sees only what
// they own that matches the syntax).

import { useEffect, useMemo, useState } from "react";
import {
  collectionStats,
  useDeckStore,
  entryQuantity,
  entryFoilQuantity,
  type CollectionEntry,
  type CollectionGroup,
  DEFAULT_GROUP_ID,
} from "@/lib/store";
import type { Card } from "@/lib/types";
import { scryfall, frontImage } from "@/lib/scryfall";
import { CardDetail } from "./CardDetail";
import { CardHoverLayer, hoverProps, useCardHover } from "./CardHoverPreview";
import { ManaCost, ColorIdentityPips } from "./ManaCost";
import { ConfirmDialog } from "./ConfirmDialog";
import { CollectionImportModal } from "./CollectionImportModal";

type SortMode = "name" | "value" | "set" | "added";

const COLORS = ["W", "U", "B", "R", "G"] as const;
const ALL_GROUPS = "__all__";

export function CollectionView() {
  const collection = useDeckStore((s) => s.collection);
  const groups = useDeckStore((s) => s.collectionGroups);
  const fastAddGroupId = useDeckStore((s) => s.profile.fastAddGroupId ?? DEFAULT_GROUP_ID);
  const {
    addToCollection,
    removeFromCollection,
    setCollectionQuantity,
    clearCollection,
  } = useDeckStore();

  const groupList = useMemo(
    () =>
      Object.values(groups ?? {}).sort((a, b) => {
        if (a.id === DEFAULT_GROUP_ID) return -1;
        if (b.id === DEFAULT_GROUP_ID) return 1;
        return a.createdAt - b.createdAt;
      }),
    [groups],
  );

  // Currently selected group (or ALL_GROUPS for the aggregate view).
  const [activeGroupId, setActiveGroupId] = useState<string>(DEFAULT_GROUP_ID);
  const activeGroupArg = activeGroupId === ALL_GROUPS ? undefined : activeGroupId;

  const stats = useMemo(
    () => collectionStats(collection, activeGroupArg),
    [collection, activeGroupArg],
  );

  // ---- Local filters ----
  const [nameQuery, setNameQuery] = useState("");
  const [scryfallQuery, setScryfallQuery] = useState("");
  const [scryfallIds, setScryfallIds] = useState<Set<string> | null>(null);
  const [scryfallLoading, setScryfallLoading] = useState(false);
  const [scryfallError, setScryfallError] = useState<string | null>(null);
  const [setFilter, setSetFilter] = useState<string>("All");
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [minValue, setMinValue] = useState<string>("");
  const [maxValue, setMaxValue] = useState<string>("");
  const [sort, setSort] = useState<SortMode>("name");
  const [inspect, setInspect] = useState<Card | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showGroupManager, setShowGroupManager] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const hover = useCardHover();

  // Entries that belong in the current group view.
  const entries = useMemo(() => {
    const all = Object.values(collection);
    if (activeGroupId === ALL_GROUPS) {
      return all.filter((e) => entryQuantity(e) + entryFoilQuantity(e) > 0);
    }
    return all.filter(
      (e) =>
        entryQuantity(e, activeGroupId) + entryFoilQuantity(e, activeGroupId) > 0,
    );
  }, [collection, activeGroupId]);

  // Distinct sets present in the visible entries.
  const setsInView = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entries) m.set(e.card.set.toUpperCase(), e.card.set_name ?? e.card.set.toUpperCase());
    return Array.from(m.entries()).sort(([, a], [, b]) => a.localeCompare(b));
  }, [entries]);

  // ---- Run Scryfall search when scryfallQuery changes (debounced) ----
  useEffect(() => {
    if (!scryfallQuery.trim()) {
      setScryfallIds(null);
      setScryfallError(null);
      return;
    }
    const t = window.setTimeout(async () => {
      setScryfallLoading(true);
      setScryfallError(null);
      try {
        const list = await scryfall.searchCards(scryfallQuery.trim(), { order: "name" });
        const ids = new Set(list.data.map((c) => c.id));
        setScryfallIds(ids);
      } catch (e) {
        setScryfallError(e instanceof Error ? e.message : "Scryfall query failed");
        setScryfallIds(new Set());
      } finally {
        setScryfallLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [scryfallQuery]);

  const visible = useMemo(() => {
    const min = parseFloat(minValue);
    const max = parseFloat(maxValue);
    let out = entries;
    if (nameQuery.trim()) {
      const q = nameQuery.trim().toLowerCase();
      out = out.filter((e) => e.card.name.toLowerCase().includes(q));
    }
    if (scryfallIds !== null) {
      out = out.filter((e) => scryfallIds.has(e.card.id));
    }
    if (setFilter !== "All") {
      out = out.filter((e) => e.card.set.toUpperCase() === setFilter);
    }
    if (colorFilter.length > 0) {
      out = out.filter((e) =>
        colorFilter.every((c) => e.card.color_identity.includes(c as Card["color_identity"][number])),
      );
    }
    if (!Number.isNaN(min)) {
      out = out.filter((e) => parseFloat(e.card.prices?.usd ?? "0") >= min);
    }
    if (!Number.isNaN(max)) {
      out = out.filter((e) => parseFloat(e.card.prices?.usd ?? "0") <= max);
    }
    if (sort === "name") out = [...out].sort((a, b) => a.card.name.localeCompare(b.card.name));
    else if (sort === "value")
      out = [...out].sort(
        (a, b) => parseFloat(b.card.prices?.usd ?? "0") - parseFloat(a.card.prices?.usd ?? "0"),
      );
    else if (sort === "set")
      out = [...out].sort(
        (a, b) =>
          (a.card.set_name ?? a.card.set).localeCompare(b.card.set_name ?? b.card.set) ||
          a.card.name.localeCompare(b.card.name),
      );
    else if (sort === "added") out = [...out].sort((a, b) => b.acquiredAt - a.acquiredAt);
    return out;
  }, [entries, nameQuery, scryfallIds, setFilter, colorFilter, minValue, maxValue, sort]);

  function toggleColor(c: string) {
    setColorFilter((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  // The group we'll mutate when the user clicks +/- on a card. ALL view
  // points its writes at the default group as a sane default.
  const writeGroupId = activeGroupId === ALL_GROUPS ? DEFAULT_GROUP_ID : activeGroupId;
  const activeGroup = groups[activeGroupId === ALL_GROUPS ? DEFAULT_GROUP_ID : activeGroupId];
  const fastAddGroup = groups[fastAddGroupId] ?? groups[DEFAULT_GROUP_ID];

  return (
    <div className="max-w-[1500px] mx-auto px-4 py-6 space-y-5">
      {/* Stats hero */}
      <section className="panel p-5">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-3xl bg-gradient-to-r from-sky-400 via-violet-400 to-violet-600 bg-clip-text text-transparent">
              Your Collection
            </h1>
            <p className="text-zinc-400 text-sm mt-1">
              Stored locally in your browser. <button onClick={() => setShowImport(true)} className="text-violet-400 underline hover:text-violet-300">Import a list</button>, or add cards from any card&rsquo;s detail view, the search panel, or the recommendation feed.
            </p>
            {fastAddGroup && (
              <p className="text-[11px] text-zinc-500 mt-1">
                Quick-add target: <span className="text-violet-300">{fastAddGroup.name}</span>
                <button
                  onClick={() => setShowGroupManager(true)}
                  className="ml-2 underline hover:text-violet-400"
                >
                  change
                </button>
              </p>
            )}
          </div>
          <div className="flex items-stretch gap-2 flex-wrap">
            <StatTile label="Unique" value={stats.uniqueCards.toLocaleString()} />
            <StatTile label="Total cards" value={stats.totalCards.toLocaleString()} />
            <StatTile
              label="Est. value"
              value={`$${stats.estimatedValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
              accent="emerald"
            />
            <button
              onClick={() => setShowImport(true)}
              className="btn btn-primary text-xs self-end"
              title="Import a list of cards into your collection"
            >
              📥 Import
            </button>
            <button
              onClick={() => setShowGroupManager(true)}
              className="btn btn-ghost text-xs self-end"
              title="Create or manage collection groups"
            >
              Manage groups
            </button>
            {entries.length > 0 && activeGroupId === ALL_GROUPS && (
              <button
                onClick={() => setConfirmClear(true)}
                className="btn btn-ghost text-xs self-end hover:!text-red-400"
                title="Remove every card from your collection"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Group tabs */}
      <section className="flex items-center gap-1 flex-wrap">
        <GroupTab
          label="All groups"
          active={activeGroupId === ALL_GROUPS}
          onClick={() => setActiveGroupId(ALL_GROUPS)}
        />
        {groupList.map((g) => (
          <GroupTab
            key={g.id}
            label={g.name}
            active={activeGroupId === g.id}
            isFastAdd={g.id === fastAddGroupId}
            onClick={() => setActiveGroupId(g.id)}
          />
        ))}
        <button
          onClick={() => setShowGroupManager(true)}
          className="text-xs px-2 py-1 rounded text-zinc-400 hover:text-violet-300 hover:bg-bg-raised"
          title="Create a new group"
        >
          + New group
        </button>
      </section>

      {/* Filters */}
      <section className="panel p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Filter by name…"
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            className="flex-1 min-w-[200px] bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/60"
          />
          <input
            type="search"
            placeholder='Scryfall syntax (e.g. t:creature pow>=4 c:b)'
            value={scryfallQuery}
            onChange={(e) => setScryfallQuery(e.target.value)}
            className="flex-1 min-w-[260px] bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/60 font-mono"
            title="Filters your collection to only the cards that match this Scryfall search"
          />
          {scryfallLoading && <span className="text-xs text-violet-400">Searching…</span>}
        </div>
        {scryfallError && (
          <div className="text-xs text-red-400">Scryfall: {scryfallError}</div>
        )}

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-zinc-400">Set</span>
            <select
              value={setFilter}
              onChange={(e) => setSetFilter(e.target.value)}
              className="bg-bg-raised border border-bg-border rounded px-2 py-1"
            >
              <option value="All">All ({setsInView.length})</option>
              {setsInView.map(([code, name]) => (
                <option key={code} value={code}>
                  {name} · {code}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <span className="text-zinc-400">Color</span>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => toggleColor(c)}
                className={`mana-symbol mana-${c} ${
                  colorFilter.includes(c) ? "ring-2 ring-violet-400" : "opacity-60 hover:opacity-100"
                }`}
                style={{ width: "1.4em", height: "1.4em", fontSize: "0.85em" }}
                title={`Filter by ${c}`}
              >
                {c}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1">
            <span className="text-zinc-400">Value</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="min"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              className="w-20 bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-xs"
            />
            <span className="text-zinc-500">–</span>
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="max"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              className="w-20 bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-xs"
            />
          </label>

          <label className="flex items-center gap-1 ml-auto">
            <span className="text-zinc-400">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
              className="bg-bg-raised border border-bg-border rounded px-2 py-1"
            >
              <option value="name">Name</option>
              <option value="value">Value (high → low)</option>
              <option value="set">Set</option>
              <option value="added">Recently added</option>
            </select>
          </label>

          <span className="text-[10px] text-zinc-500">{visible.length} shown</span>
        </div>
      </section>

      {/* Grid */}
      <section>
        {entries.length === 0 ? (
          <div className="panel p-12 text-center text-zinc-400">
            <div className="text-5xl mb-3">📦</div>
            <h3 className="font-display text-xl text-violet-300 mb-1">
              {activeGroupId === ALL_GROUPS
                ? "Your collection is empty"
                : `${activeGroup?.name ?? "Group"} is empty`}
            </h3>
            <p className="text-sm">
              Add cards from the search panel on the build page, or from any card&rsquo;s detail view.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="panel p-12 text-center text-zinc-500 text-sm">
            No cards match these filters. Try widening the criteria.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {visible.map((entry) => (
              <CollectionCard
                key={entry.cardId}
                entry={entry}
                groupId={activeGroupArg}
                writeGroupId={writeGroupId}
                onInspect={(c) => setInspect(c)}
                onIncrement={(foil) => addToCollection(entry.card, 1, foil, writeGroupId)}
                onDecrement={(foil) => removeFromCollection(entry.cardId, 1, foil, writeGroupId)}
                onSetQuantity={(qty, foil) => setCollectionQuantity(entry.cardId, qty, foil, writeGroupId)}
                hoverProps={hoverProps(entry.card, hover)}
              />
            ))}
          </div>
        )}
      </section>

      {inspect && <CardDetail card={inspect} onClose={() => setInspect(null)} />}

      <ConfirmDialog
        open={confirmClear}
        title="Clear entire collection?"
        message="Every card and quantity in every group will be removed. This cannot be undone."
        confirmLabel="Clear"
        cancelLabel="Keep"
        destructive
        onConfirm={() => {
          clearCollection();
          setConfirmClear(false);
        }}
        onCancel={() => setConfirmClear(false)}
      />

      {showGroupManager && (
        <GroupManagerModal
          onClose={() => setShowGroupManager(false)}
          onSwitchTo={(id) => {
            setActiveGroupId(id);
            setShowGroupManager(false);
          }}
        />
      )}

      <CollectionImportModal open={showImport} onClose={() => setShowImport(false)} />

      <CardHoverLayer hover={hover} />
    </div>
  );
}

function GroupTab({
  label,
  active,
  isFastAdd,
  onClick,
}: {
  label: string;
  active: boolean;
  isFastAdd?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-md border transition flex items-center gap-1.5 ${
        active
          ? "bg-violet-600 border-violet-500 text-white"
          : "bg-bg-raised border-bg-border text-zinc-300 hover:bg-bg-border"
      }`}
    >
      <span>{label}</span>
      {isFastAdd && (
        <span title="Fast-add target" className="text-[9px] opacity-80">
          ⚡
        </span>
      )}
    </button>
  );
}

function StatTile({
  label,
  value,
  accent = "violet",
}: {
  label: string;
  value: string;
  accent?: "violet" | "emerald";
}) {
  const valueColor = accent === "emerald" ? "text-emerald-300" : "text-violet-300";
  return (
    <div className="rounded-md border border-bg-border bg-bg-raised px-3 py-1.5 text-right">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`font-mono text-base leading-tight ${valueColor}`}>{value}</div>
    </div>
  );
}

function CollectionCard({
  entry,
  groupId,
  onInspect,
  onIncrement,
  onDecrement,
  onSetQuantity,
  hoverProps,
}: {
  entry: CollectionEntry;
  groupId: string | undefined;     // for read (show qty in this group, or aggregate)
  writeGroupId: string;            // for write (which group +/- mutates)
  onInspect: (c: Card) => void;
  onIncrement: (foil: boolean) => void;
  onDecrement: (foil: boolean) => void;
  onSetQuantity: (qty: number, foil: boolean) => void;
  hoverProps: React.HTMLAttributes<HTMLElement>;
}) {
  const img = frontImage(entry.card, "normal");
  const usd = parseFloat(entry.card.prices?.usd ?? "0") || 0;
  const usdFoil = parseFloat(entry.card.prices?.usd_foil ?? entry.card.prices?.usd ?? "0") || 0;
  const qty = entryQuantity(entry, groupId);
  const foilQty = entryFoilQuantity(entry, groupId);
  const totalValue = qty * usd + foilQty * usdFoil;
  return (
    <article {...hoverProps} className="panel overflow-hidden flex flex-col">
      <button onClick={() => onInspect(entry.card)} className="block w-full text-left">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt={entry.card.name} className="w-full block" loading="lazy" draggable={false} />
        ) : (
          <div className="aspect-[5/7] bg-bg-raised flex items-center justify-center text-xs p-2 text-center">
            {entry.card.name}
          </div>
        )}
      </button>
      <div className="p-2 text-xs space-y-1">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold truncate" title={entry.card.name}>{entry.card.name}</span>
          <ManaCost cost={entry.card.mana_cost} />
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <ColorIdentityPips colors={entry.card.color_identity} />
          <span className="truncate">{entry.card.set_name ?? entry.card.set.toUpperCase()}</span>
          {totalValue > 0 && (
            <span className="ml-auto text-emerald-400">${totalValue.toFixed(2)}</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1 pt-1">
          <QtyControl
            label="Reg"
            quantity={qty}
            onMinus={() => onDecrement(false)}
            onPlus={() => onIncrement(false)}
            onSet={(q) => onSetQuantity(q, false)}
          />
          <QtyControl
            label="Foil"
            quantity={foilQty}
            onMinus={() => onDecrement(true)}
            onPlus={() => onIncrement(true)}
            onSet={(q) => onSetQuantity(q, true)}
            accent="violet"
          />
        </div>
      </div>
    </article>
  );
}

function QtyControl({
  label,
  quantity,
  onMinus,
  onPlus,
  onSet,
  accent,
}: {
  label: string;
  quantity: number;
  onMinus: () => void;
  onPlus: () => void;
  onSet: (q: number) => void;
  accent?: "violet";
}) {
  const valueClass =
    accent === "violet"
      ? quantity > 0 ? "text-violet-300" : "text-zinc-500"
      : quantity > 0 ? "text-zinc-100" : "text-zinc-500";
  return (
    <div className="flex items-center gap-1 bg-bg-raised border border-bg-border rounded px-1 py-0.5">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500 w-6">{label}</span>
      <button
        onClick={onMinus}
        disabled={quantity === 0}
        className="text-zinc-400 hover:text-red-400 disabled:opacity-30 px-1"
        aria-label={`Decrease ${label} quantity`}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        max={99}
        value={quantity}
        onChange={(e) => onSet(Math.max(0, Number(e.target.value) || 0))}
        className={`w-8 bg-transparent text-center font-mono text-xs ${valueClass} outline-none`}
      />
      <button
        onClick={onPlus}
        className="text-zinc-400 hover:text-emerald-400 px-1"
        aria-label={`Increase ${label} quantity`}
      >
        +
      </button>
    </div>
  );
}

// ---- Group manager modal ------------------------------------------------

function GroupManagerModal({
  onClose,
  onSwitchTo,
}: {
  onClose: () => void;
  onSwitchTo: (id: string) => void;
}) {
  const groups = useDeckStore((s) => s.collectionGroups);
  const fastAddGroupId = useDeckStore((s) => s.profile.fastAddGroupId ?? DEFAULT_GROUP_ID);
  const collection = useDeckStore((s) => s.collection);
  const {
    createCollectionGroup,
    renameCollectionGroup,
    deleteCollectionGroup,
    setFastAddGroup,
  } = useDeckStore();

  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<CollectionGroup | null>(null);

  const list = useMemo(
    () =>
      Object.values(groups ?? {}).sort((a, b) => {
        if (a.id === DEFAULT_GROUP_ID) return -1;
        if (b.id === DEFAULT_GROUP_ID) return 1;
        return a.createdAt - b.createdAt;
      }),
    [groups],
  );

  function countInGroup(id: string): number {
    let n = 0;
    for (const e of Object.values(collection)) {
      const g = e.groupQuantities?.[id];
      if (g) n += g.quantity + g.foilQuantity;
    }
    return n;
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    const id = createCollectionGroup(name);
    setNewName("");
    onSwitchTo(id);
  }

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_120ms_ease-out]"
        onClick={onClose}
      >
        <div
          className="panel w-full max-w-lg p-5 space-y-4 animate-[popIn_140ms_ease-out]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-display text-xl text-violet-300">Collection groups</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Create sub-collections (binders, trade lists, deck piles). Pick one as the
                ⚡ <span className="text-violet-300">fast-add</span> target — that&rsquo;s where the per-card
                &ldquo;+ Collection&rdquo; button on recommendation/search cards puts them.
              </p>
            </div>
            <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          {/* List */}
          <ul className="space-y-1.5">
            {list.map((g) => {
              const isFastAdd = g.id === fastAddGroupId;
              const isDefault = g.id === DEFAULT_GROUP_ID;
              const count = countInGroup(g.id);
              return (
                <li
                  key={g.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                    isFastAdd ? "border-violet-600/40 bg-violet-900/10" : "border-bg-border bg-bg-raised"
                  }`}
                >
                  {renameId === g.id ? (
                    <>
                      <input
                        value={renameValue}
                        maxLength={40}
                        autoFocus
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            renameCollectionGroup(g.id, renameValue);
                            setRenameId(null);
                          } else if (e.key === "Escape") {
                            setRenameId(null);
                          }
                        }}
                        className="flex-1 bg-bg-base border border-bg-border rounded px-2 py-1 text-sm"
                      />
                      <button
                        onClick={() => {
                          renameCollectionGroup(g.id, renameValue);
                          setRenameId(null);
                        }}
                        className="text-xs text-emerald-400 hover:underline"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setRenameId(null)}
                        className="text-xs text-zinc-400 hover:underline"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => onSwitchTo(g.id)}
                        className="flex-1 text-left text-sm font-medium text-zinc-100 hover:text-violet-300 truncate"
                        title="Switch to this group"
                      >
                        {g.name}
                        {isDefault && (
                          <span className="ml-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">default</span>
                        )}
                      </button>
                      <span className="text-[11px] text-zinc-400 font-mono">{count}</span>
                      <button
                        onClick={() => setFastAddGroup(g.id)}
                        className={`text-[11px] px-2 py-0.5 rounded border ${
                          isFastAdd
                            ? "border-violet-500 bg-violet-600 text-white"
                            : "border-bg-border text-zinc-400 hover:text-violet-300"
                        }`}
                        title={isFastAdd ? "This is the fast-add target" : "Make this the fast-add target"}
                      >
                        {isFastAdd ? "⚡ fast-add" : "set fast-add"}
                      </button>
                      <button
                        onClick={() => {
                          setRenameId(g.id);
                          setRenameValue(g.name);
                        }}
                        className="text-[11px] text-zinc-400 hover:text-violet-300 px-1"
                        title="Rename"
                      >
                        ✎
                      </button>
                      {!isDefault && (
                        <button
                          onClick={() => setConfirmDelete(g)}
                          className="text-[11px] text-zinc-400 hover:text-red-400 px-1"
                          title="Delete (cards move to default)"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Create */}
          <div className="flex items-center gap-2 pt-2 border-t border-bg-border">
            <input
              value={newName}
              maxLength={40}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              placeholder="New group name (e.g. Trade binder)"
              className="flex-1 bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm"
            />
            <button onClick={handleCreate} className="btn btn-primary">
              + Create
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          open={confirmDelete !== null}
          title={`Delete "${confirmDelete.name}"?`}
          message={`Cards in this group will move to "${groups[DEFAULT_GROUP_ID]?.name ?? "Main collection"}". The group itself will be removed.`}
          confirmLabel="Delete group"
          cancelLabel="Keep"
          destructive
          onConfirm={() => {
            deleteCollectionGroup(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </>
  );
}
