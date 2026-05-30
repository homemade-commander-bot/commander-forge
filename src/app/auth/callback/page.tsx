"use client";

// Landing page for every magic-link / OAuth sign-in.
//
// With implicit flow the session arrives in the URL fragment
// (#access_token=...). The Supabase browser client's `detectSessionInUrl`
// parses that fragment when it initializes, so by the time this page mounts
// a session usually already exists; we confirm it (with an auth-state
// listener as a backup) and then redirect.
//
// Unlike the previous server route, this surfaces real success/error
// feedback instead of silently bouncing home with an unread ?auth_error.
// A fragment is never sent to the server, which is exactly why this must be
// a client page, not a route handler.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"working" | "error">("working");
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setStatus("error");
      setMessage("Cloud sync isn't configured for this deployment.");
      return;
    }

    // Surface an error handed back in the fragment or query (expired or
    // already-used link, provider denial, etc.).
    const frag = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const rawErr =
      frag.get("error_description") ||
      query.get("error_description") ||
      frag.get("error") ||
      query.get("error");
    if (rawErr) {
      setStatus("error");
      setMessage(decodeURIComponent(rawErr).replace(/\+/g, " "));
      return;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const next = query.get("next");
      const dest =
        next && next.startsWith("/") && !next.startsWith("//") ? next : "/profile";
      router.replace(dest);
    };

    // detectSessionInUrl parses the fragment on client init; confirm via
    // getSession and keep a listener in case it resolves a beat later.
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) finish();
    });

    sb.auth.getSession().then(({ data }) => {
      if (data.session) {
        finish();
        return;
      }
      // Give detectSessionInUrl a moment, then re-check once before failing.
      window.setTimeout(async () => {
        const { data: again } = await sb.auth.getSession();
        if (again.session) finish();
        else {
          setStatus("error");
          setMessage(
            "We couldn't complete sign-in. The link may have expired or already been used — request a new magic link and try again.",
          );
        }
      }, 1500);
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="panel p-8 max-w-md w-full text-center space-y-4">
        <img src="/manarune-icon.png" alt="" width={48} height={48} className="h-12 w-12 rounded-lg mx-auto" />
        {status === "working" ? (
          <>
            <div className="font-display text-xl text-violet-300">{message}</div>
            <div className="text-sm text-zinc-400">One moment while we verify your link.</div>
            <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-bg-raised">
              <div className="h-full w-1/2 animate-pulse bg-violet-500" />
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-xl text-red-300">Sign-in didn&rsquo;t complete</div>
            <p className="text-sm text-zinc-300">{message}</p>
            <Link href="/profile" className="btn btn-primary inline-flex">
              Back to sign in
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
