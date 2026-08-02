"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { signOut, useSession } from "@/lib/auth-client";
import { canConfigure, isAdmin } from "@/lib/permissions";

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
      {canConfigure(role) && (
        <Link href="/lexicon" className="hover:text-fg">
          Pronunciation
        </Link>
      )}
      {isAdmin(role) && (
        <Link href="/admin" className="hover:text-fg">
          Users
        </Link>
      )}
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
