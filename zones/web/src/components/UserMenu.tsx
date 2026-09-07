"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { UserRound } from "lucide-react";

import { signOut, useSession } from "@/lib/auth-client";
import { canConfigure, canTriageFeedback, isAdmin } from "@/lib/permissions";
import { useLang } from "@/lib/use-lang";

/**
 * The account control in the header: an icon button, and everything else behind it.
 *
 * It reads the session in the browser rather than in the layout on purpose: a session read
 * in the root layout is a database round trip in front of every page view, including the
 * ones a guest is here for, and it opts the whole app into dynamic rendering.
 *
 * COLLAPSED INTO A MENU because the header ran out of room. Signed in as an admin it was
 * showing four role links, a profile link, an email address, a role badge and a sign-out
 * button, all in one row beside the brand, the feedback button, the support button and
 * the language switch. Everything here is either rare (the role pages), or a statement
 * rather than an action (the email, the role), and neither earns permanent width.
 *
 * The language switch deliberately stayed outside: it changes what every page shows and
 * is the one control here somebody uses repeatedly.
 */
export function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  // The two links below lead to pages that live under a language, so they keep the
  // one being read rather than dropping back to English on the way.
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);

  // Escape and outside clicks, the two ways out of a menu everybody expects. Bound only
  // while it is open, so a closed menu costs nothing per keystroke on the page.
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Nothing until the session resolves, so a signed-in user does not see a "Sign in"
  // flash on every navigation.
  if (isPending) return null;

  if (!session) {
    return (
      <nav className="flex items-center gap-3 text-muted">
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
  const item = "block w-full px-3 py-1.5 text-left hover:bg-border hover:text-fg";

  return (
    <div ref={menu} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${session.user.email}`}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-muted hover:text-fg"
      >
        <UserRound className="h-4 w-4" aria-hidden />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-56 rounded border border-border bg-panel py-1 text-sm text-muted shadow-lg"
        >
          {/* Who you are signed in as, and what that lets you do. Both were in the
              header before; both are answers to a question asked once a session. */}
          <div className="border-b border-border px-3 pt-1 pb-2">
            <div className="truncate text-fg" title={session.user.email}>
              {session.user.email}
            </div>
            <div className="mt-1 inline-block rounded border border-border px-1.5 text-xs uppercase">
              {role ?? "member"}
            </div>
          </div>

          {/* Named "Reports" rather than "Feedback", because the header has a Feedback
              button and they do opposite things: that one files a report, this reads them. */}
          {canTriageFeedback(role) && (
            <Link href={`/${lang}/feedback`} role="menuitem" className={item} onClick={() => setOpen(false)}>
              Reports
            </Link>
          )}
          {canConfigure(role) && (
            <Link
              href={`/${lang}/pronunciation`}
              role="menuitem"
              className={item}
              onClick={() => setOpen(false)}
            >
              Pronunciation
            </Link>
          )}
          {canConfigure(role) && (
            <Link href={`/${lang}/voice`} role="menuitem" className={item} onClick={() => setOpen(false)}>
              Voice
            </Link>
          )}
          {isAdmin(role) && (
            <Link href="/admin" role="menuitem" className={item} onClick={() => setOpen(false)}>
              Users
            </Link>
          )}

          {/* The account's own page, and the only place an ElevenLabs key can be set.
              Shown to every signed-in user, unlike the links above it. */}
          <div className="mt-1 border-t border-border pt-1">
            <Link href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut().then(() => router.refresh());
              }}
              className={item}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
