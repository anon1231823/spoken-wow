"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut, useSession } from "@/lib/auth-client";
import { canConfigureGeneration, canManageVoices, isAdmin } from "@/lib/permissions";

/**
 * The session indicator in the header.
 *
 * It reads the session in the browser rather than through a server component on purpose:
 * an RSC session read in the root layout would opt every page into dynamic rendering and
 * put a database round trip in front of every page view of a tool that is otherwise served
 * entirely off disk.
 */
export default function UserMenu() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  // Rendering nothing until the session resolves avoids a "Sign in" flash for a user who
  // is in fact signed in.
  if (isPending) return null;

  if (!session) {
    return (
      <nav className="flex items-center gap-1">
        <Button asChild variant="ghost" size="sm">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/register">Register</Link>
        </Button>
      </nav>
    );
  }

  const role = session.user.role;

  return (
    <nav className="flex items-center gap-2">
      {canManageVoices(role) && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/voices">Voices</Link>
        </Button>
      )}
      {canConfigureGeneration(role) && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/lexicon">Pronunciation</Link>
        </Button>
      )}
      {isAdmin(role) && (
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin">Users</Link>
        </Button>
      )}
      <span className="text-muted-foreground hidden text-xs sm:inline">
        {session.user.email}
      </span>
      <Badge variant="outline" className="uppercase">
        {role ?? "member"}
      </Badge>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => signOut().then(() => router.refresh())}
      >
        Sign out
      </Button>
    </nav>
  );
}
