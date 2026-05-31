"use client";

// Lazy client-only mount for the headless <SyncEngine />. Loading it via
// next/dynamic with ssr:false keeps @supabase/* out of the initial bundle
// for every page — it streams in as its own chunk right after hydration,
// off the critical path. Sync starts a beat after load, which is invisible
// for a background sync engine.

import dynamic from "next/dynamic";

const SyncEngine = dynamic(() => import("./SyncEngine").then((m) => m.SyncEngine), {
  ssr: false,
});

export function SyncEngineMount() {
  return <SyncEngine />;
}
