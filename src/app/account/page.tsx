import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { CloudSync } from "@/components/CloudSync";

export const metadata: Metadata = {
  title: "Account — Manarune",
  description: "Sign in to sync your decks, collection, and profile across devices.",
};

export default function AccountPage() {
  return (
    <>
      <Header />
      <main className="flex-1 max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="font-display text-3xl bg-gradient-to-r from-sky-400 via-violet-400 to-violet-600 bg-clip-text text-transparent">
            Account
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Sign in to back up and sync your decks, collection, and profile across devices.
            It&rsquo;s optional — Manarune works fully without an account, storing everything in this browser.
          </p>
        </div>

        <CloudSync />

        <section className="panel p-5">
          <h2 className="font-display text-lg text-violet-300 mb-2">How it works</h2>
          <ul className="text-xs text-zinc-400 space-y-1.5 list-disc pl-4">
            <li>Passwordless: we email a one-time magic link. Open it on any device to sign in there.</li>
            <li>Your decks, collection, and profile sync automatically while you&rsquo;re signed in.</li>
            <li>When the same item exists on two devices, the most recently edited copy wins.</li>
            <li>Signing out leaves this device&rsquo;s local copy intact — nothing is deleted.</li>
          </ul>
        </section>

        <p className="text-xs text-zinc-500">
          <Link href="/profile" className="text-violet-400 hover:underline underline-offset-2">
            ← Back to profile
          </Link>
        </p>
      </main>
    </>
  );
}
