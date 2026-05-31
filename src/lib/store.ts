"use client";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { Card, Deck, DeckEntry } from "./types";
import { categorize } from "./analytics";
import { isUnlimitedQuantity } from "./commander-rules";

// ---- localStorage rename migration ----------------------------------------
// The product renamed from "Commander Forge" → "Manarune" in v1.1.0, which
// changed the persisted localStorage key from "mtg-commander-deck-builder" to
// "manarune". This custom storage wrapper transparently copies the legacy
// key's value forward on first read, so existing users keep every deck and
// collection card without doing anything. The legacy key is left in place as
// a backup; we'll prune it in a future release after enough time has passed
// that all active users have rehydrated at least once.
const LEGACY_KEY = "mtg-commander-deck-builder";

const renamingStorage: StateStorage = {
  getItem: (name: string) => {
    if (typeof window === "undefined") return null;
    const current = window.localStorage.getItem(name);
    if (current !== null) return current;
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy !== null) {
      // Copy the legacy snapshot under the new key so subsequent reads
      // are fast and don't need to keep checking the old key.
      window.localStorage.setItem(name, legacy);
      return legacy;
    }
    return null;
  },
  setItem: (name: string, value: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(name, value);
  },
  removeItem: (name: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(name);
  },
};

const newDeckId = () => `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const AVATARS = ["🐉", "🧙", "🗡️", "🛡️", "👑", "🔮", "🐺", "🦅", "🦂", "🐍", "🌿", "⚡", "🌑", "☀️", "💀", "🔥"];

export interface Profile {
  name: string;
  avatar: string;
  createdAt: number;
  // Last time the user explicitly edited the profile. The last-write-wins
  // tiebreaker for cloud sync. Defaults to 0 ("never edited") so a fresh
  // device's untouched default profile always yields to a customized cloud
  // profile rather than overwriting it.
  updatedAt?: number;
  preferredColors: string[];
  favoriteThemes: string[];
  // Which collection group the per-card "+ Collection" / fast-add
  // button targets. Defaults to the always-present "default" group.
  fastAddGroupId?: string;
}

const defaultProfile = (): Profile => ({
  name: "Planeswalker",
  avatar: "🧙",
  createdAt: Date.now(),
  updatedAt: 0,
  preferredColors: [],
  favoriteThemes: [],
  fastAddGroupId: DEFAULT_GROUP_ID,
});

// A user-defined group ("Main collection", "Trade binder", "Tergrid
// pile", etc.). The store always carries a "default" group that
// can't be deleted; users can create as many additional groups as
// they like and pick one as the fast-add target. Cards live in one
// or more groups via per-group quantities on each entry.
export interface CollectionGroup {
  id: string;
  name: string;
  createdAt: number;
}

export const DEFAULT_GROUP_ID = "default";

// A single owned printing, keyed by Scryfall card.id (so different
// printings of the same card are tracked independently). Foil and
// non-foil counts are kept separate because they have different
// market values and most collectors care which they own.
//
// Group-aware: per-group quantities live in `groupQuantities`. The
// top-level totals are derived (entryQuantity / entryFoilQuantity).
export interface CollectionEntry {
  cardId: string;
  card: Card;
  acquiredAt: number;
  // Last time this entry's quantities changed. Last-write-wins tiebreaker
  // for cloud sync (mirrors Deck.updatedAt). Optional for back-compat with
  // entries persisted before sync existed; treated as 0 when absent.
  updatedAt?: number;
  groupQuantities: Record<string, { quantity: number; foilQuantity: number }>;
}

interface DeckStore {
  profile: Profile;
  decks: Record<string, Deck>;
  activeDeckId: string | null;

  // The user's owned-cards collection. Keyed by Scryfall card.id, so
  // multiple printings of the same card live as separate entries (Beta
  // Lightning Bolt vs. M11 Lightning Bolt).
  collection: Record<string, CollectionEntry>;

  // User-defined collection groups. Always contains a "default" entry.
  collectionGroups: Record<string, CollectionGroup>;

  // Session-only: card IDs the user has already seen in the SwipeFeed for
  // each deck this session. Cleared on commander change and on full
  // page reload (not persisted). Stored as object so Zustand can serialize.
  swipedIds: Record<string, string[]>;

  setProfile: (patch: Partial<Profile>) => void;
  resetProfile: () => void;

  createDeck: (name?: string) => string;
  duplicateDeck: (id: string) => string | null;
  deleteDeck: (id: string) => void;
  setActiveDeck: (id: string) => void;
  renameDeck: (id: string, name: string) => void;

  setCommander: (deckId: string, card: Card) => void;
  setPartner: (deckId: string, card: Card | null) => void;

  addCard: (deckId: string, card: Card, quantity?: number) => void;
  removeCard: (deckId: string, cardId: string) => void;
  setQuantity: (deckId: string, cardId: string, quantity: number) => void;
  // Swap one printing of a card for another printing of the same card
  // name. Preserves quantity, fires only if same name (printing-only
  // change), and repoints commanderId/partnerId if they referenced the
  // old printing.
  replacePrinting: (deckId: string, oldCardId: string, newCard: Card) => void;

  setNotes: (deckId: string, notes: string) => void;
  setThemes: (deckId: string, themes: string[]) => void;

  markSwiped: (deckId: string, cardId: string) => void;
  resetSwiped: (deckId: string) => void;

  addToCollection: (card: Card, quantity?: number, foil?: boolean, groupId?: string) => void;
  removeFromCollection: (cardId: string, quantity?: number, foil?: boolean, groupId?: string) => void;
  setCollectionQuantity: (cardId: string, quantity: number, foil?: boolean, groupId?: string) => void;
  clearCollection: () => void;
  // Convenience: adds 1 non-foil to whatever group is set as the
  // user's fast-add target (defaults to the "default" group).
  fastAddToCollection: (card: Card) => void;

  createCollectionGroup: (name: string) => string;
  renameCollectionGroup: (id: string, name: string) => void;
  deleteCollectionGroup: (id: string) => void;
  setFastAddGroup: (id: string) => void;
}

const emptyDeck = (name = "New Deck"): Deck => ({
  id: newDeckId(),
  name,
  entries: {},
  themes: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export const AVATAR_OPTIONS = AVATARS;

export const useDeckStore = create<DeckStore>()(
  persist(
    (set, get) => ({
      profile: defaultProfile(),
      decks: {},
      activeDeckId: null,
      collection: {},
      collectionGroups: {
        [DEFAULT_GROUP_ID]: {
          id: DEFAULT_GROUP_ID,
          name: "Main collection",
          createdAt: Date.now(),
        },
      },
      swipedIds: {},

      // Stamp updatedAt on every explicit edit so cloud sync can resolve
      // which device's profile is newest. fastAddGroupId changes are a local
      // UI preference, not profile content, so they don't bump the stamp.
      setProfile: (patch) =>
        set((s) => ({
          profile: {
            ...s.profile,
            ...patch,
            updatedAt: "fastAddGroupId" in patch && Object.keys(patch).length === 1
              ? s.profile.updatedAt
              : Date.now(),
          },
        })),
      resetProfile: () => set({ profile: defaultProfile() }),

      createDeck: (name) => {
        const deck = emptyDeck(name);
        set((s) => ({ decks: { ...s.decks, [deck.id]: deck }, activeDeckId: deck.id }));
        return deck.id;
      },

      duplicateDeck: (id) => {
        const src = get().decks[id];
        if (!src) return null;
        const copy: Deck = {
          ...src,
          id: newDeckId(),
          name: `${src.name} (Copy)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          entries: { ...src.entries },
        };
        set((s) => ({ decks: { ...s.decks, [copy.id]: copy }, activeDeckId: copy.id }));
        return copy.id;
      },

      deleteDeck: (id) =>
        set((s) => {
          const next = { ...s.decks };
          delete next[id];
          return {
            decks: next,
            activeDeckId: s.activeDeckId === id ? (Object.keys(next)[0] ?? null) : s.activeDeckId,
          };
        }),

      setActiveDeck: (id) => set({ activeDeckId: id }),

      renameDeck: (id, name) =>
        set((s) => {
          const deck = s.decks[id];
          if (!deck) return s;
          return { decks: { ...s.decks, [id]: { ...deck, name, updatedAt: Date.now() } } };
        }),

      setCommander: (deckId, card) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          const entries = { ...deck.entries };
          if (deck.commanderId && entries[deck.commanderId]) delete entries[deck.commanderId];
          entries[card.id] = { cardId: card.id, card, quantity: 1, category: "Commander" };
          // Reset swipe history — recommendations will rebuild for the new commander.
          const nextSwiped = { ...(s.swipedIds ?? {}) };
          delete nextSwiped[deckId];
          return {
            decks: {
              ...s.decks,
              [deckId]: { ...deck, commanderId: card.id, entries, updatedAt: Date.now() },
            },
            swipedIds: nextSwiped,
          };
        }),

      setPartner: (deckId, card) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          const entries = { ...deck.entries };
          if (deck.partnerId && entries[deck.partnerId]) delete entries[deck.partnerId];
          if (card) {
            entries[card.id] = { cardId: card.id, card, quantity: 1, category: "Commander" };
          }
          return {
            decks: {
              ...s.decks,
              [deckId]: { ...deck, partnerId: card?.id, entries, updatedAt: Date.now() },
            },
          };
        }),

      addCard: (deckId, card, quantity = 1) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          // Singleton enforcement (CR 903.5b): unless the card is a basic
          // land or an explicit "any number" card (Persistent Petitioners,
          // Relentless Rats, etc.), a deck may have only one card with a
          // given English name. If a different printing of the same card
          // is already in the deck, treat the new add as a no-op rather
          // than creating a second entry that the validator will flag.
          if (!isUnlimitedQuantity(card)) {
            const sameName = Object.values(deck.entries).find(
              (e) => e.card.name === card.name && e.cardId !== card.id,
            );
            if (sameName) return s;
          }
          const existing = deck.entries[card.id];
          const next: DeckEntry = existing
            ? { ...existing, quantity: existing.quantity + quantity }
            : { cardId: card.id, card, quantity, category: categorize(card) };
          return {
            decks: {
              ...s.decks,
              [deckId]: {
                ...deck,
                entries: { ...deck.entries, [card.id]: next },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      removeCard: (deckId, cardId) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          const entries = { ...deck.entries };
          delete entries[cardId];
          const update: Partial<Deck> = { entries, updatedAt: Date.now() };
          if (deck.commanderId === cardId) update.commanderId = undefined;
          if (deck.partnerId === cardId) update.partnerId = undefined;
          return { decks: { ...s.decks, [deckId]: { ...deck, ...update } } };
        }),

      setQuantity: (deckId, cardId, quantity) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          const entry = deck.entries[cardId];
          if (!entry) return s;
          if (quantity <= 0) {
            const entries = { ...deck.entries };
            delete entries[cardId];
            return { decks: { ...s.decks, [deckId]: { ...deck, entries, updatedAt: Date.now() } } };
          }
          return {
            decks: {
              ...s.decks,
              [deckId]: {
                ...deck,
                entries: { ...deck.entries, [cardId]: { ...entry, quantity } },
                updatedAt: Date.now(),
              },
            },
          };
        }),

      replacePrinting: (deckId, oldCardId, newCard) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          const old = deck.entries[oldCardId];
          if (!old) return s;
          // Sanity: only allow same-name swaps. Different cards should
          // go through removeCard + addCard.
          if (old.card.name !== newCard.name) return s;
          // No-op if it's literally the same printing.
          if (oldCardId === newCard.id) return s;
          const entries = { ...deck.entries };
          delete entries[oldCardId];
          // If the new printing is somehow already in the deck (it
          // shouldn't be — singleton check would have rejected it),
          // sum the quantities; otherwise install the new entry fresh
          // with the old entry's quantity preserved.
          const existingNew = entries[newCard.id];
          entries[newCard.id] = existingNew
            ? { ...existingNew, quantity: existingNew.quantity + old.quantity }
            : {
                cardId: newCard.id,
                card: newCard,
                quantity: old.quantity,
                category: old.category,
              };
          const update: Partial<Deck> = { entries, updatedAt: Date.now() };
          if (deck.commanderId === oldCardId) update.commanderId = newCard.id;
          if (deck.partnerId === oldCardId) update.partnerId = newCard.id;
          return { decks: { ...s.decks, [deckId]: { ...deck, ...update } } };
        }),

      setNotes: (deckId, notes) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          return { decks: { ...s.decks, [deckId]: { ...deck, notes, updatedAt: Date.now() } } };
        }),

      setThemes: (deckId, themes) =>
        set((s) => {
          const deck = s.decks[deckId];
          if (!deck) return s;
          return { decks: { ...s.decks, [deckId]: { ...deck, themes, updatedAt: Date.now() } } };
        }),

      markSwiped: (deckId, cardId) =>
        set((s) => {
          const all = s.swipedIds ?? {};
          const existing = all[deckId] ?? [];
          if (existing.includes(cardId)) return s;
          return { swipedIds: { ...all, [deckId]: [...existing, cardId] } };
        }),

      resetSwiped: (deckId) =>
        set((s) => {
          const all = s.swipedIds ?? {};
          const next = { ...all };
          delete next[deckId];
          return { swipedIds: next };
        }),

      addToCollection: (card, quantity = 1, foil = false, groupId = DEFAULT_GROUP_ID) =>
        set((s) => {
          const all = s.collection ?? {};
          const existing = all[card.id];
          const groups = existing?.groupQuantities ?? {};
          const cur = groups[groupId] ?? { quantity: 0, foilQuantity: 0 };
          const nextGroup = {
            quantity: foil ? cur.quantity : cur.quantity + quantity,
            foilQuantity: foil ? cur.foilQuantity + quantity : cur.foilQuantity,
          };
          const nextEntry: CollectionEntry = {
            cardId: card.id,
            card,
            acquiredAt: existing?.acquiredAt ?? Date.now(),
            updatedAt: Date.now(),
            groupQuantities: { ...groups, [groupId]: nextGroup },
          };
          return { collection: { ...all, [card.id]: nextEntry } };
        }),

      removeFromCollection: (cardId, quantity = 1, foil = false, groupId = DEFAULT_GROUP_ID) =>
        set((s) => {
          const all = s.collection ?? {};
          const existing = all[cardId];
          if (!existing) return s;
          const groups = existing.groupQuantities ?? {};
          const cur = groups[groupId];
          if (!cur) return s;
          const nextQ = foil ? cur.quantity : Math.max(0, cur.quantity - quantity);
          const nextF = foil ? Math.max(0, cur.foilQuantity - quantity) : cur.foilQuantity;
          const nextGroups = { ...groups };
          if (nextQ === 0 && nextF === 0) {
            delete nextGroups[groupId];
          } else {
            nextGroups[groupId] = { quantity: nextQ, foilQuantity: nextF };
          }
          const next = { ...all };
          if (Object.keys(nextGroups).length === 0) {
            delete next[cardId];
          } else {
            next[cardId] = { ...existing, groupQuantities: nextGroups, updatedAt: Date.now() };
          }
          return { collection: next };
        }),

      setCollectionQuantity: (cardId, quantity, foil = false, groupId = DEFAULT_GROUP_ID) =>
        set((s) => {
          const all = s.collection ?? {};
          const existing = all[cardId];
          if (!existing) return s;
          const groups = existing.groupQuantities ?? {};
          const cur = groups[groupId] ?? { quantity: 0, foilQuantity: 0 };
          const nextQ = foil ? cur.quantity : Math.max(0, quantity);
          const nextF = foil ? Math.max(0, quantity) : cur.foilQuantity;
          const nextGroups = { ...groups };
          if (nextQ === 0 && nextF === 0) {
            delete nextGroups[groupId];
          } else {
            nextGroups[groupId] = { quantity: nextQ, foilQuantity: nextF };
          }
          const next = { ...all };
          if (Object.keys(nextGroups).length === 0) {
            delete next[cardId];
          } else {
            next[cardId] = { ...existing, groupQuantities: nextGroups, updatedAt: Date.now() };
          }
          return { collection: next };
        }),

      clearCollection: () => set({ collection: {} }),

      fastAddToCollection: (card) => {
        const groupId = get().profile.fastAddGroupId ?? DEFAULT_GROUP_ID;
        // If the saved fast-add group has been deleted, fall back to default.
        const groups = get().collectionGroups ?? {};
        const target = groups[groupId] ? groupId : DEFAULT_GROUP_ID;
        get().addToCollection(card, 1, false, target);
      },

      createCollectionGroup: (name) => {
        const id = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        set((s) => ({
          collectionGroups: {
            ...(s.collectionGroups ?? {}),
            [id]: { id, name: name.trim() || "Untitled group", createdAt: Date.now() },
          },
        }));
        return id;
      },

      renameCollectionGroup: (id, name) =>
        set((s) => {
          const groups = s.collectionGroups ?? {};
          const g = groups[id];
          if (!g) return s;
          return {
            collectionGroups: { ...groups, [id]: { ...g, name: name.trim() || g.name } },
          };
        }),

      deleteCollectionGroup: (id) =>
        set((s) => {
          if (id === DEFAULT_GROUP_ID) return s; // can't delete the default
          const groups = { ...(s.collectionGroups ?? {}) };
          if (!groups[id]) return s;
          delete groups[id];
          // Move any per-entry quantities from the deleted group into default.
          const collection = { ...(s.collection ?? {}) };
          for (const [cardId, entry] of Object.entries(collection)) {
            const gq = entry.groupQuantities ?? {};
            const removed = gq[id];
            if (!removed) continue;
            const nextGroups = { ...gq };
            delete nextGroups[id];
            const def = nextGroups[DEFAULT_GROUP_ID] ?? { quantity: 0, foilQuantity: 0 };
            nextGroups[DEFAULT_GROUP_ID] = {
              quantity: def.quantity + removed.quantity,
              foilQuantity: def.foilQuantity + removed.foilQuantity,
            };
            collection[cardId] = { ...entry, groupQuantities: nextGroups, updatedAt: Date.now() };
          }
          // If profile pointed at the deleted group, reset fast-add to default.
          const profile = s.profile.fastAddGroupId === id
            ? { ...s.profile, fastAddGroupId: DEFAULT_GROUP_ID }
            : s.profile;
          return { collectionGroups: groups, collection, profile };
        }),

      setFastAddGroup: (id) =>
        set((s) => {
          const groups = s.collectionGroups ?? {};
          if (!groups[id]) return s;
          return { profile: { ...s.profile, fastAddGroupId: id } };
        }),
    }),
    {
      // Renamed from "mtg-commander-deck-builder" in v1.1.0. The
      // renamingStorage wrapper above copies the legacy key forward
      // on first read so existing users keep all their decks and
      // their collection across the rename.
      name: "manarune",
      storage: createJSONStorage(() => renamingStorage),
      version: 5,
      // swipedIds is intentionally session-only (not persisted) — it's a
      // "don't show me this card twice this session" filter, not user data.
      partialize: (state) => ({
        profile: state.profile,
        decks: state.decks,
        activeDeckId: state.activeDeckId,
        collection: state.collection,
        collectionGroups: state.collectionGroups,
      }),
      migrate: (state: unknown, fromVersion: number) => {
        let s = (state ?? {}) as Partial<DeckStore>;
        if (fromVersion < 2 && !s.profile) {
          s = { ...s, profile: defaultProfile() };
        }
        if (fromVersion < 3 && s.decks) {
          // v3 migration: dedupe duplicate-by-name entries that pre-date
          // the singleton check in addCard. Caused by the seedNewDeckStaples
          // race where two simultaneous calls each fetched a Sol Ring and
          // both added before either had landed in the store. Keeps the
          // first occurrence of each name; drops subsequent duplicates.
          const decks: Record<string, Deck> = {};
          for (const [id, deck] of Object.entries(s.decks)) {
            decks[id] = dedupeDeckByName(deck);
          }
          s = { ...s, decks };
        }
        if (fromVersion < 4 && !s.collection) {
          // v4: introduce the owned-cards collection.
          s = { ...s, collection: {} };
        }
        if (fromVersion < 5) {
          // v5: introduce per-group quantities and the collectionGroups
          // store. Old entries had flat {quantity, foilQuantity}; convert
          // them into a single "default" group.
          const groups: Record<string, CollectionGroup> = s.collectionGroups ?? {
            [DEFAULT_GROUP_ID]: {
              id: DEFAULT_GROUP_ID,
              name: "Main collection",
              createdAt: Date.now(),
            },
          };
          if (!groups[DEFAULT_GROUP_ID]) {
            groups[DEFAULT_GROUP_ID] = {
              id: DEFAULT_GROUP_ID,
              name: "Main collection",
              createdAt: Date.now(),
            };
          }
          const collection: Record<string, CollectionEntry> = {};
          if (s.collection) {
            for (const [id, raw] of Object.entries(s.collection)) {
              // raw may be the v4 shape (flat quantity/foilQuantity) or
              // already the new shape from a partial migration.
              const e = raw as unknown as {
                cardId: string;
                card: Card;
                acquiredAt: number;
                quantity?: number;
                foilQuantity?: number;
                groupQuantities?: Record<string, { quantity: number; foilQuantity: number }>;
              };
              if (e.groupQuantities) {
                collection[id] = {
                  cardId: e.cardId,
                  card: e.card,
                  acquiredAt: e.acquiredAt,
                  groupQuantities: e.groupQuantities,
                };
              } else {
                collection[id] = {
                  cardId: e.cardId,
                  card: e.card,
                  acquiredAt: e.acquiredAt,
                  groupQuantities: {
                    [DEFAULT_GROUP_ID]: {
                      quantity: e.quantity ?? 0,
                      foilQuantity: e.foilQuantity ?? 0,
                    },
                  },
                };
              }
            }
          }
          // Make sure the profile carries fastAddGroupId
          const profile = s.profile
            ? { ...s.profile, fastAddGroupId: s.profile.fastAddGroupId ?? DEFAULT_GROUP_ID }
            : defaultProfile();
          s = { ...s, collection, collectionGroups: groups, profile };
        }
        return s as DeckStore;
      },
      // Belt-and-suspenders: on rehydrate, ensure session-only fields the
      // persisted state doesn't carry (swipedIds) are initialized to safe
      // defaults. Older persisted shapes lack this field; code reads
      // `state.swipedIds[deckId]` and would throw on undefined.
      onRehydrateStorage: () => (state) => {
        if (state && !state.swipedIds) {
          state.swipedIds = {};
        }
        if (state && !state.collection) {
          state.collection = {};
        }
        if (state && (!state.collectionGroups || !state.collectionGroups[DEFAULT_GROUP_ID])) {
          state.collectionGroups = {
            ...(state.collectionGroups ?? {}),
            [DEFAULT_GROUP_ID]: {
              id: DEFAULT_GROUP_ID,
              name: "Main collection",
              createdAt: Date.now(),
            },
          };
        }
        if (state && !state.profile.fastAddGroupId) {
          state.profile = { ...state.profile, fastAddGroupId: DEFAULT_GROUP_ID };
        }
      },
    },
  ),
);

export function activeDeck(s: DeckStore): Deck | null {
  return s.activeDeckId ? (s.decks[s.activeDeckId] ?? null) : null;
}

// ---- Collection selectors ----------------------------------------------

export interface CollectionStats {
  uniqueCards: number;
  totalCards: number;        // includes foil
  estimatedValueUsd: number; // non-foil price + foil price (USD)
}

// Total non-foil count across all groups (or a specific group, if given).
export function entryQuantity(entry: CollectionEntry, groupId?: string): number {
  const groups = entry.groupQuantities ?? {};
  if (groupId !== undefined) return groups[groupId]?.quantity ?? 0;
  let s = 0;
  for (const g of Object.values(groups)) s += g.quantity;
  return s;
}

export function entryFoilQuantity(entry: CollectionEntry, groupId?: string): number {
  const groups = entry.groupQuantities ?? {};
  if (groupId !== undefined) return groups[groupId]?.foilQuantity ?? 0;
  let s = 0;
  for (const g of Object.values(groups)) s += g.foilQuantity;
  return s;
}

export function entryTotal(entry: CollectionEntry, groupId?: string): number {
  return entryQuantity(entry, groupId) + entryFoilQuantity(entry, groupId);
}

export function collectionStats(
  collection: Record<string, CollectionEntry>,
  groupId?: string,
): CollectionStats {
  let unique = 0;
  let total = 0;
  let value = 0;
  for (const e of Object.values(collection)) {
    const q = entryQuantity(e, groupId);
    const f = entryFoilQuantity(e, groupId);
    const qty = q + f;
    if (qty <= 0) continue;
    unique += 1;
    total += qty;
    const usd = parseFloat(e.card.prices?.usd ?? "0") || 0;
    const usdFoil = parseFloat(e.card.prices?.usd_foil ?? e.card.prices?.usd ?? "0") || 0;
    value += q * usd + f * usdFoil;
  }
  return { uniqueCards: unique, totalCards: total, estimatedValueUsd: value };
}

// Build a Set of names the user owns ≥1 of (any printing, any finish,
// any group). Cheaper than iterating the collection on every render of
// every card.
export function ownedCardNames(collection: Record<string, CollectionEntry>): Set<string> {
  const out = new Set<string>();
  for (const e of Object.values(collection)) {
    if (entryTotal(e) > 0) out.add(e.card.name);
  }
  return out;
}

// Drop duplicate-by-name entries from a deck (CR 903.5b), keeping the
// first occurrence by insertion order. Basics and "any number" cards
// (Relentless Rats, etc.) are exempt because the rule allows multiples.
// Used by the v3 migration and also exported so we can call it after a
// suspicious bulk-add.
export function dedupeDeckByName(deck: Deck): Deck {
  if (!deck || !deck.entries) return deck;
  const seen = new Set<string>();
  const next: Record<string, DeckEntry> = {};
  for (const [id, entry] of Object.entries(deck.entries)) {
    if (isUnlimitedQuantity(entry.card)) {
      next[id] = entry;
      continue;
    }
    if (seen.has(entry.card.name)) continue;
    seen.add(entry.card.name);
    next[id] = entry;
  }
  // If commander/partner refs pointed at a dropped entry, repoint them
  // at whichever entry of that name survived.
  let commanderId = deck.commanderId;
  let partnerId = deck.partnerId;
  if (commanderId && !next[commanderId]) {
    const cmd = Object.values(next).find((e) => e.cardId === commanderId);
    commanderId = cmd?.cardId;
  }
  if (partnerId && !next[partnerId]) {
    const p = Object.values(next).find((e) => e.cardId === partnerId);
    partnerId = p?.cardId;
  }
  return { ...deck, entries: next, commanderId, partnerId };
}
