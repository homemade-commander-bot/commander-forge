"use client";

import { useEffect, useState } from "react";
import type { Card, Ruling } from "@/lib/types";
import { scryfall, frontImage, backImage, safeHttpUrl } from "@/lib/scryfall";
import { ManaCost } from "./ManaCost";
import { useDeckStore, entryQuantity, entryFoilQuantity, DEFAULT_GROUP_ID } from "@/lib/store";
import { haptic } from "@/lib/feedback";

interface Props {
  card: Card | null;
  deckId?: string;
  onClose: () => void;
}

export function CardDetail({ card, deckId, onClose }: Props) {
  const {
    addCard,
    removeCard,
    setCommander,
    decks,
    addToCollection,
    removeFromCollection,
    replacePrinting,
  } = useDeckStore();
  const collectionEntry = useDeckStore((s) => (card ? s.collection?.[card.id] : undefined));
  const collectionGroups = useDeckStore((s) => s.collectionGroups);
  const fastAddGroupId = useDeckStore((s) => s.profile.fastAddGroupId ?? DEFAULT_GROUP_ID);
  const [rulings, setRulings] = useState<Ruling[] | null>(null);
  const [loadingRulings, setLoadingRulings] = useState(false);
  const [showBack, setShowBack] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [printings, setPrintings] = useState<Card[] | null>(null);
  const [loadingPrintings, setLoadingPrintings] = useState(false);
  const [printingsOpen, setPrintingsOpen] = useState(false);

  const inDeck = !!(card && deckId && decks[deckId]?.entries[card.id]);
  const isCommander = !!(card && deckId && decks[deckId]?.commanderId === card.id);
  const ownedCount = collectionEntry
    ? entryQuantity(collectionEntry) + entryFoilQuantity(collectionEntry)
    : 0;
  const fastAddGroup = collectionGroups?.[fastAddGroupId] ?? collectionGroups?.[DEFAULT_GROUP_ID];

  useEffect(() => {
    setRulings(null);
    setShowBack(false);
    setPrintings(null);
    setPrintingsOpen(false);
    if (!card) return;
    setLoadingRulings(true);
    scryfall
      .rulingsById(card.id)
      .then((r) => setRulings(r.data))
      .catch(() => setRulings([]))
      .finally(() => setLoadingRulings(false));
  }, [card]);

  if (!card) return null;
  const front = frontImage(card, "large");
  const back = backImage(card, "large");
  const img = showBack ? back : front;

  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="panel max-w-4xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Mobile: stack image above details. Desktop: side-by-side
            with a fixed-width image column so the rules text gets the
            remaining space. */}
        <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4 p-3 sm:p-4">
          <div className="flex-shrink-0 w-full max-w-[260px] sm:max-w-none sm:w-72 mx-auto sm:mx-0">
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img} alt={card.name} className="rounded-lg card-shadow w-full" />
            ) : (
              <div className="aspect-[5/7] bg-bg-raised rounded-lg flex items-center justify-center text-zinc-500">{card.name}</div>
            )}
            {back && (
              <button onClick={() => setShowBack((v) => !v)} className="btn btn-ghost mt-2 w-full justify-center">
                Flip
              </button>
            )}
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="flex items-start gap-2">
              <h2 className="font-display text-2xl flex-1">{card.name}</h2>
              <button onClick={onClose} className="text-zinc-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <ManaCost cost={card.mana_cost} />
              <span className="text-zinc-400 text-sm">·</span>
              <span className="text-zinc-300 text-sm">{card.type_line}</span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {card.set_name} (#{card.collector_number}) · {card.rarity}
            </div>

            {card.oracle_text && (
              <pre className="mt-3 text-sm text-zinc-200 whitespace-pre-wrap font-sans bg-bg-raised rounded p-3 border border-bg-border">
                {card.oracle_text}
              </pre>
            )}
            {card.card_faces && card.card_faces.length > 1 && (
              <div className="mt-2 space-y-2">
                {card.card_faces.map((f, i) => (
                  <div key={i} className="bg-bg-raised border border-bg-border rounded p-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{f.name}</span>
                      <ManaCost cost={f.mana_cost} />
                    </div>
                    <div className="text-xs text-zinc-400">{f.type_line}</div>
                    {f.oracle_text && (
                      <pre className="mt-1 text-xs whitespace-pre-wrap font-sans">{f.oracle_text}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(card.power || card.toughness) && (
              <div className="mt-2 text-sm text-zinc-300">
                P/T: {card.power}/{card.toughness}
              </div>
            )}
            {card.loyalty && (
              <div className="mt-2 text-sm text-zinc-300">Loyalty: {card.loyalty}</div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Info label="Color identity" value={card.color_identity.join("") || "Colorless"} />
              <Info label="Mana value" value={String(card.cmc)} />
              <Info label="Commander legal" value={card.legalities.commander} />
              <Info label="EDHREC rank" value={card.edhrec_rank ? `#${card.edhrec_rank}` : "—"} />
              <Info label="Price (USD)" value={card.prices.usd ? `$${card.prices.usd}` : "—"} />
              <Info label="Released" value={card.released_at} />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {deckId && (
                <>
                  {!inDeck ? (
                    <button onClick={() => { addCard(deckId, card); haptic(); }} className="btn btn-primary">+ Add to deck</button>
                  ) : (
                    <button onClick={() => removeCard(deckId, card.id)} className="btn btn-danger">Remove</button>
                  )}
                  {!isCommander && card.legalities.commander === "legal" && (
                    <button onClick={() => setCommander(deckId, card)} className="btn btn-ghost">
                      Set as Commander
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => addToCollection(card, 1, false, fastAddGroupId)}
                className="btn btn-ghost"
                title={`Add 1 non-foil copy to ${fastAddGroup?.name ?? "your collection"}`}
              >
                ⚡ + {fastAddGroup?.name ?? "Collection"}
                {ownedCount > 0 && <span className="ml-1 text-violet-300">({ownedCount} owned)</span>}
              </button>
              <button
                onClick={() => addToCollection(card, 1, true, fastAddGroupId)}
                className="btn btn-ghost"
                title={`Add 1 foil copy to ${fastAddGroup?.name ?? "your collection"}`}
              >
                + Foil
              </button>
              <button
                onClick={() => setShowGroupPicker((v) => !v)}
                className="btn btn-ghost"
                title="Add to a specific collection group"
              >
                ▾ Group…
              </button>
              {ownedCount > 0 && (
                <button
                  onClick={() => removeFromCollection(card.id, 1, false, fastAddGroupId)}
                  className="btn btn-ghost text-zinc-400 hover:!text-red-400"
                  title={`Remove 1 from ${fastAddGroup?.name ?? "your collection"}`}
                >
                  − Collection
                </button>
              )}
              {safeHttpUrl(card.purchase_uris?.tcgplayer) && (
                <a href={safeHttpUrl(card.purchase_uris?.tcgplayer)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  Buy on TCGplayer
                </a>
              )}
              {safeHttpUrl(card.purchase_uris?.cardmarket) && (
                <a href={safeHttpUrl(card.purchase_uris?.cardmarket)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  Cardmarket
                </a>
              )}
              {safeHttpUrl(card.related_uris?.edhrec) && (
                <a href={safeHttpUrl(card.related_uris?.edhrec)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  EDHREC
                </a>
              )}
              {safeHttpUrl(card.scryfall_uri) && (
                <a href={safeHttpUrl(card.scryfall_uri)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                  Scryfall
                </a>
              )}
            </div>

            {showGroupPicker && collectionGroups && (
              <div className="mt-2 panel p-3 bg-bg-raised">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-2">
                  Add to a specific group
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.values(collectionGroups)
                    .sort((a, b) => {
                      if (a.id === DEFAULT_GROUP_ID) return -1;
                      if (b.id === DEFAULT_GROUP_ID) return 1;
                      return a.createdAt - b.createdAt;
                    })
                    .map((g) => {
                      const inGroup = collectionEntry
                        ? entryQuantity(collectionEntry, g.id) + entryFoilQuantity(collectionEntry, g.id)
                        : 0;
                      return (
                        <div key={g.id} className="flex items-center gap-1 bg-bg-base border border-bg-border rounded px-2 py-1">
                          <span className="text-xs text-zinc-200">{g.name}</span>
                          {inGroup > 0 && (
                            <span className="text-[10px] text-violet-300 font-mono">({inGroup})</span>
                          )}
                          <button
                            onClick={() => addToCollection(card, 1, false, g.id)}
                            className="text-xs text-emerald-400 hover:text-emerald-300 px-1"
                            title={`+1 to ${g.name}`}
                          >
                            +
                          </button>
                          <button
                            onClick={() => addToCollection(card, 1, true, g.id)}
                            className="text-[10px] text-violet-400 hover:text-violet-300 px-1"
                            title={`+1 foil to ${g.name}`}
                          >
                            +F
                          </button>
                          {inGroup > 0 && (
                            <button
                              onClick={() => removeFromCollection(card.id, 1, false, g.id)}
                              className="text-xs text-zinc-500 hover:text-red-400 px-1"
                              title={`-1 from ${g.name}`}
                            >
                              −
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="mt-4">
              <h3 className="text-sm font-semibold text-violet-400 mb-1">Official rulings</h3>
              {loadingRulings && <div className="text-xs text-zinc-500">Loading…</div>}
              {!loadingRulings && rulings && rulings.length === 0 && (
                <div className="text-xs text-zinc-500">No rulings published.</div>
              )}
              <ul className="space-y-1 text-xs">
                {rulings?.map((r, i) => (
                  <li key={i} className="border-l-2 border-bg-border pl-2 py-1">
                    <span className="text-zinc-500 mr-2">{r.published_at}</span>
                    <span className="text-zinc-200">{r.comment}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Printings — different arts / sets / collector numbers */}
            <PrintingsBlock
              card={card}
              currentCardId={card.id}
              deckId={deckId}
              open={printingsOpen}
              loading={loadingPrintings}
              printings={printings}
              onToggle={async () => {
                const next = !printingsOpen;
                setPrintingsOpen(next);
                if (next && !printings && !loadingPrintings) {
                  setLoadingPrintings(true);
                  try {
                    const all = await scryfall.printingsOf(card);
                    setPrintings(all);
                  } catch {
                    setPrintings([]);
                  } finally {
                    setLoadingPrintings(false);
                  }
                }
              }}
              onUseArt={(p) => {
                if (deckId) replacePrinting(deckId, card.id, p);
              }}
              onAddToCollection={(p) => { addToCollection(p, 1, false, fastAddGroupId); haptic(); }}
              fastAddGroupName={fastAddGroup?.name}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function PrintingsBlock({
  card,
  currentCardId,
  deckId,
  open,
  loading,
  printings,
  onToggle,
  onUseArt,
  onAddToCollection,
  fastAddGroupName,
}: {
  card: Card;
  currentCardId: string;
  deckId: string | undefined;
  open: boolean;
  loading: boolean;
  printings: Card[] | null;
  onToggle: () => void;
  onUseArt: (printing: Card) => void;
  onAddToCollection: (printing: Card) => void;
  fastAddGroupName?: string;
}) {
  // We don't know the total count until we fetch, but Scryfall typically
  // gives 50–100 prints for popular cards; show "Printings ▾" until expanded.
  const count = printings?.length;
  return (
    <div className="mt-4">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-sm font-semibold text-violet-400 hover:text-violet-300"
        aria-expanded={open}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>Printings{count !== undefined ? ` (${count})` : ""}</span>
        <span className="text-[10px] text-zinc-500 font-normal ml-1">
          alternate art, set, and price
        </span>
      </button>
      {open && (
        <div className="mt-2 border border-bg-border rounded-md p-2 max-h-[40vh] overflow-y-auto">
          {loading && <div className="text-xs text-zinc-500 p-2">Loading printings…</div>}
          {!loading && printings && printings.length === 0 && (
            <div className="text-xs text-zinc-500 p-2">
              Could not load other printings. Try opening the Scryfall page in a new tab.
            </div>
          )}
          {!loading && printings && printings.length > 0 && (
            <ul className="space-y-1.5">
              {printings.map((p) => {
                const img = frontImage(p, "small") ?? frontImage(p, "art_crop");
                const isCurrent = p.id === currentCardId;
                const price = p.prices?.usd;
                return (
                  <li
                    key={p.id}
                    className={`flex items-center gap-2 rounded px-2 py-1.5 ${
                      isCurrent
                        ? "bg-violet-900/20 border border-violet-700/40"
                        : "bg-bg-raised hover:bg-bg-border border border-transparent"
                    }`}
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={`${p.set_name} printing of ${p.name}`}
                        className="w-10 h-14 rounded object-cover flex-shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-10 h-14 rounded bg-bg-border flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-zinc-100 truncate">
                        {p.set_name}{" "}
                        <span className="text-zinc-500 font-mono text-[10px]">
                          {p.set.toUpperCase()} · #{p.collector_number}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-400 flex items-center gap-2 flex-wrap">
                        {p.artist && <span>{p.artist}</span>}
                        {p.released_at && <span>· {p.released_at}</span>}
                        {price && <span className="text-emerald-400">· ${price}</span>}
                        {isCurrent && <span className="text-violet-300">· current</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {deckId && !isCurrent && (
                        <button
                          onClick={() => onUseArt(p)}
                          className="text-[11px] px-2 py-1 rounded border border-violet-700/40 bg-violet-900/20 text-violet-200 hover:bg-violet-900/40"
                          title="Replace this card in the deck with this printing (quantity preserved)"
                        >
                          Use this art
                        </button>
                      )}
                      <button
                        onClick={() => onAddToCollection(p)}
                        className="text-[11px] px-2 py-1 rounded border border-bg-border bg-bg-raised text-zinc-300 hover:text-violet-300"
                        title={`Add this specific printing to ${fastAddGroupName ?? "your collection"}`}
                      >
                        + Coll
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {/* Keep currentCardId referenced for completeness even though
          it's currently only used to mark the active row. */}
      <span className="hidden" aria-hidden>{currentCardId}</span>
      <span className="hidden" aria-hidden>{card.id}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-raised border border-bg-border rounded px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-zinc-200">{value}</div>
    </div>
  );
}
