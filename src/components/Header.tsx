"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDeckStore } from "@/lib/store";
import { useAuth } from "@/lib/auth-state";
import { useSyncUi } from "@/lib/sync";

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, decks, activeDeckId, createDeck, setActiveDeck } = useDeckStore();
  const list = Object.values(decks).sort((a, b) => b.updatedAt - a.updatedAt);
  const { user, syncEnabled } = useAuth();
  const syncStatus = useSyncUi((s) => s.status);

  function nav(path: string) {
    return `text-sm transition-colors px-2 py-1 rounded ${
      pathname === path ? "text-violet-300 bg-bg-raised" : "text-zinc-300 hover:text-white"
    }`;
  }

  return (
    <header className="border-b border-bg-border bg-bg-panel/85 backdrop-blur sticky top-0 z-30">
      <div className="max-w-[1700px] mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-2 sm:gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-display text-lg sm:text-xl tracking-wide whitespace-nowrap"
        >
          <img
            src="/manarune-icon.png"
            alt="Manarune"
            width={28}
            height={28}
            className="h-7 w-7 rounded-md shrink-0"
          />
          <span className="bg-gradient-to-r from-sky-400 via-violet-400 to-violet-600 bg-clip-text text-transparent">
            Manarune
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          <Link href="/" className={nav("/")}>My Decks</Link>
          <Link href="/build" className={nav("/build")}>Builder</Link>
          <Link href="/collection" className={nav("/collection")}>Collection</Link>
          <Link href="/play" className={nav("/play")}>Life</Link>
          <Link href="/rules" className={nav("/rules")}>Rules</Link>
        </nav>
        {/* Mobile-only compact nav (visible below md). Each route gets
            an emoji + short label so the bar fits in <320px. */}
        <nav className="md:hidden flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
          <Link href="/" className={`${nav("/")} text-xs px-2`} title="My Decks">📚</Link>
          <Link href="/build" className={`${nav("/build")} text-xs px-2`} title="Builder">🛠</Link>
          <Link href="/collection" className={`${nav("/collection")} text-xs px-2`} title="Collection">📦</Link>
          <Link href="/play" className={`${nav("/play")} text-xs px-2`} title="Life Tracker">❤️</Link>
          <Link href="/rules" className={`${nav("/rules")} text-xs px-2`} title="Rules">📜</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {list.length > 0 && pathname === "/build" && (
            <select
              className="bg-bg-raised border border-bg-border rounded px-1.5 sm:px-2 py-1 text-xs sm:text-sm max-w-[120px] sm:max-w-[200px]"
              value={activeDeckId ?? ""}
              onChange={(e) => setActiveDeck(e.target.value)}
            >
              {list.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <button
            className="btn btn-ghost text-xs sm:text-sm px-2 sm:px-3"
            onClick={() => {
              const id = createDeck("Untitled Deck");
              if (pathname !== "/commanders") router.push("/commanders");
              setActiveDeck(id);
            }}
            title="Create a new deck"
          >
            {/* Text composed of a constant root + a responsive suffix
                so a DOM-text scraper sees either "+ New" or "+ New Deck"
                but never both concatenated. */}
            + New<span className="hidden sm:inline"> Deck</span>
          </button>
          {/* Sign-in entry point — only shown when sync is configured and the
              user is signed out. Hidden entirely for self-hosters with no
              Supabase env vars, so there's no dead button. */}
          {syncEnabled && !user && (
            <Link href="/account" className="btn btn-ghost text-xs sm:text-sm px-2 sm:px-3" title="Sign in to sync across devices">
              Sign in
            </Link>
          )}
          <Link href="/profile" className="relative flex items-center gap-2 px-1.5 sm:px-2 py-1 rounded hover:bg-bg-raised" title={user ? `Signed in as ${user.email}` : "Profile"}>
            <span className="text-xl sm:text-2xl leading-none">{profile.avatar}</span>
            {/* Synced indicator dot when signed in. */}
            {user && (
              <span
                aria-hidden
                title={syncStatus === "error" ? "Sync error" : syncStatus === "syncing" ? "Syncing…" : "Synced"}
                className={`absolute top-0.5 right-0.5 h-2 w-2 rounded-full ring-2 ring-bg-panel ${
                  syncStatus === "error" ? "bg-red-400" : syncStatus === "syncing" ? "bg-violet-400 animate-pulse" : "bg-emerald-400"
                }`}
              />
            )}
            <span className="hidden sm:inline text-sm text-zinc-200">{profile.name}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
