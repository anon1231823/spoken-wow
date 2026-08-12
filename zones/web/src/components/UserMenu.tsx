"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { signOut, useSession } from "@/lib/auth-client";
import { canConfigure, canTriageFeedback, isAdmin } from "@/lib/permissions";

/**
 * The session indicator in the header, and the only place the nav links to the two pages
 * that need a role.
 *
 * It reads the session in the browser rather than in the layout on purpose: a session read
 * in the root layout is a database round trip in front of every page view, including the
 * ones a guest is here for, and it opts the whole app into dynamic rendering.
 */
export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // Nothing until the session resolves, so a signed-in user does not see a "Sign in"
  // flash on every navigation.
  if (isPending) return null;

  if (!session) {
    return (
      <nav className="ml-auto flex items-center gap-3 text-muted">
        <Link href="/login" className="hover:text-fg">
          Sign in
        </Link>
        <Link href="/register" className="hover:text-fg">
          Register
        </Link>
      </nav>
    );
  }

  const role = session.user.role;

  return (
    <nav className="ml-auto flex items-center gap-3 text-muted">
      {/* Named "Reports" rather than "Feedback", because the header already has a
          Feedback button next to this one and they do opposite things: that one files a
          report, this one reads them. */}
      {canTriageFeedback(role) && (
        <Link href="/feedback" className="hover:text-fg">
          Reports
        </Link>
      )}
      {/* External: the pronunciation editor lives in wow-voiceover, which owns the
          dictionary both projects share. /lexicon redirects there for old bookmarks. */}
      {canConfigure(role) && (
        <a href="https://voiceover.rusty.one/pronunciation" className="hover:text-fg">
          Pronunciation
        </a>
      )}
      {canConfigure(role) && (
        <Link href="/voice" className="hover:text-fg">
          Voice
        </Link>
      )}
      {isAdmin(role) && (
        <Link href="/admin" className="hover:text-fg">
          Users
        </Link>
      )}
      {/* The account's own page, and the only place an ElevenLabs key can be set. Shown
          to every signed-in user, unlike the links above it: a member's profile still
          tells them what role they have, which is the thing they are about to ask about. */}
      <Link href="/profile" className="hover:text-fg">
        Profile
      </Link>
      <span className="hidden text-xs sm:inline">{session.user.email}</span>
      <span className="rounded border border-border px-1.5 text-xs uppercase">
        {role ?? "member"}
      </span>
      <button
        type="button"
        onClick={() => signOut().then(() => router.refresh())}
        className="hover:text-fg"
      >
        Sign out
      </button>
    </nav>
  );
}
