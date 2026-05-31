"use client";

// Collection importer. Paste a list of owned cards (any "qty name" text —
// the same permissive parser the deck importer uses) and we resolve every
// name against Scryfall, preview matched/unmatched, then add the matched
// cards (with their quantities) to a chosen collection group.
//
// Reuses lib/import's parseTextDecklist + resolveDeck. A collection paste
// has no "Commander" section, so everything lands in `entries`; we also fold
// in any commanderNames defensively (as qty 1) in case a section header
// sneaks in.
//
// Portaled to document.body so the fixed overlay isn't trapped by an
// ancestor's backdrop-filter (the .panel class) — see the modal gotcha in
// SESSION-HISTORY.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { parseTextDecklist, resolveDeck, type ResolvedDeck } from "@/lib/import";
import { useDeckStore, DEFAULT_GROUP_ID } from "@/lib/store";
import { haptic } from "@/lib/feedback";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CollectionImportModal({ open, onClose }: Props) {
  const { addToCollection } = useDeckStore();
  const groups = useDeckStore((s) => s.collectionGroups);
  const fastAddGroupId = useDeckStore((s) => s.profile.fastAddGroupId ?? DEFAULT_GROUP_ID);

  const groupList = Object.values(groups ?? {}).sort((a, b) => {
    if (a.id === DEFAULT_GROUP_ID) return -1;
    if (b.id === DEFAULT_GROUP_ID) return 1;
    return a.createdAt - b.createdAt;
  });

  const [text, setText] = useState("");
  const [targetGroupId, setTargetGroupId] = useState(fastAddGroupId);
  const [asFoil, setAsFoil] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ResolvedDeck | null>(null);
  const [done, setDone] = useState<number | null>(null);

  // Keep the target-group default in sync if the fast-add group changes
  // while the modal is closed.
  useEffect(() => {
    if (!open) setTargetGroupId(fastAddGroupId);
  }, [open, fastAddGroupId]);

  function reset() {
    setText("");
    setAsFoil(false);
    setPreview(null);
    setError(null);
    setDone(null);
    setLoading(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function runPreview() {
    setError(null);
    setLoading(true);
    setPreview(null);
    try {
      if (!text.trim()) throw new Error("Paste a list of cards to preview.");
      const parsed = parseTextDecklist(text);
      if (parsed.entries.length === 0 && parsed.commanderNames.length === 0) {
        throw new Error("Nothing recognizable in that input.");
      }
      const resolved = await resolveDeck(parsed);
      setPreview(resolved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed.");
    } finally {
      setLoading(false);
    }
  }

  function confirmImport() {
    if (!preview) return;
    let added = 0;
    // Mainboard entries carry quantities; fold in any commander-section names
    // as a single copy each.
    for (const entry of preview.parsed.entries) {
      const card = preview.matched.get(entry.name.toLowerCase());
      if (!card) continue;
      addToCollection(card, entry.quantity, asFoil, targetGroupId);
      added += entry.quantity;
    }
    for (const name of preview.parsed.commanderNames) {
      const card = preview.matched.get(name.toLowerCase());
      if (!card) continue;
      addToCollection(card, 1, asFoil, targetGroupId);
      added += 1;
    }
    haptic();
    setDone(added);
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const matchedQty = preview ? preview.totalQuantity : 0;
  const uniqueMatched = preview ? preview.matched.size : 0;
  const missingCount = preview ? preview.missing.length : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-[fadeIn_120ms_ease-out]"
      onClick={close}
    >
      <div
        className="panel w-full max-w-2xl max-h-[90vh] flex flex-col animate-[popIn_140ms_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 p-4 sm:p-5 border-b border-bg-border">
          <div>
            <h2 className="font-display text-xl text-violet-300">Import to collection</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Paste a list of cards you own. Scryfall resolves every name.
            </p>
          </div>
          <button onClick={close} className="tap text-zinc-400 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {done !== null ? (
            <div className="text-center space-y-3 py-4">
              <div className="text-4xl">✅</div>
              <div className="font-display text-lg text-emerald-300">
                Added {done} card{done === 1 ? "" : "s"} to your collection
              </div>
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => { reset(); }} className="btn btn-ghost">Import more</button>
                <button onClick={close} className="btn btn-primary">Done</button>
              </div>
            </div>
          ) : !preview ? (
            <>
              <label className="block">
                <div className="text-xs text-zinc-400 mb-1">Card list</div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  placeholder={`Paste any text card list. Examples:

4 Lightning Bolt
1 Sol Ring
2x Arcane Signet
1 Rhystic Study (CMR) 90
...`}
                  className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-violet-500/60"
                  maxLength={100000}
                />
                <div className="text-[10px] text-zinc-500 mt-1">
                  Quantities are respected. Set codes and collector numbers are ignored — only the card name and quantity matter.
                </div>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-bg-border">
                <button onClick={close} className="btn btn-ghost">Cancel</button>
                <button
                  onClick={runPreview}
                  disabled={loading || !text.trim()}
                  className="btn btn-primary"
                >
                  {loading ? "Resolving…" : "Preview"}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-2 text-center">
                <SummaryTile label="Cards" value={String(matchedQty)} accent="emerald" />
                <SummaryTile label="Unique" value={String(uniqueMatched)} accent="violet" />
                <SummaryTile label="Unmatched" value={String(missingCount)} accent={missingCount > 0 ? "red" : "muted"} />
              </div>

              {missingCount > 0 && (
                <div className="rounded-md border border-yellow-700/40 bg-yellow-900/15 p-3">
                  <div className="text-xs font-semibold text-yellow-200 mb-1">
                    ⚠ {missingCount} name{missingCount === 1 ? "" : "s"} didn&rsquo;t match Scryfall
                  </div>
                  <ul className="text-[11px] text-yellow-100/80 space-y-0.5 max-h-32 overflow-y-auto font-mono">
                    {preview.missing.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                  <div className="text-[10px] text-yellow-100/60 mt-1.5">
                    Usually a typo or a card too new for Scryfall&rsquo;s mirror. The rest will still import.
                  </div>
                </div>
              )}

              {/* Target group + foil */}
              <label className="block">
                <div className="text-xs text-zinc-400 mb-1">Add to group</div>
                <select
                  value={targetGroupId}
                  onChange={(e) => setTargetGroupId(e.target.value)}
                  className="w-full bg-bg-raised border border-bg-border rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-500/60"
                >
                  {groupList.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-sm text-zinc-200">
                <input
                  type="checkbox"
                  checked={asFoil}
                  onChange={() => setAsFoil((v) => !v)}
                  className="accent-violet-500"
                />
                <span>These are all foil copies</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-bg-border">
                <button onClick={() => setPreview(null)} className="btn btn-ghost">Back</button>
                <button
                  onClick={confirmImport}
                  disabled={matchedQty === 0}
                  className="btn btn-primary"
                >
                  Add {matchedQty} card{matchedQty === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-700/40 bg-red-900/20 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SummaryTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: "emerald" | "violet" | "red" | "muted";
}) {
  const palette = {
    emerald: { bg: "border-emerald-700/40 bg-emerald-900/15", text: "text-emerald-200" },
    violet: { bg: "border-violet-700/40 bg-violet-900/15", text: "text-violet-200" },
    red: { bg: "border-red-700/40 bg-red-900/20", text: "text-red-200" },
    muted: { bg: "border-bg-border bg-bg-raised", text: "text-zinc-300" },
  }[accent];
  return (
    <div className={`rounded-md border px-2 py-1.5 ${palette.bg}`}>
      <div className={`font-mono text-lg leading-none ${palette.text}`}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-400 mt-1">{label}</div>
    </div>
  );
}
