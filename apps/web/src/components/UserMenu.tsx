"use client";

import Link from "@/components/LocaleLink";
import { useCan } from "@/components/useCan";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut, useSession } from "@/lib/auth-client";
import { canManageVoices, isAdmin } from "@/lib/permissions";

/**
 * What every visitor gets, signed in or not: the three sections, and the page an addon's
 * Contribute button leads to -- which is also where a player uploads what they gathered, and
 * had no way in from the site itself.
 */
const SECTIONS = [
  { href: "/quests", label: "Quests" },
  { href: "/zones", label: "Zones" },
  { href: "/books", label: "Books" },
  { href: "/contribute", label: "Contribute" },
];

function Sections() {
  return SECTIONS.map((section) => (
    <Button key={section.href} asChild variant="ghost" size="sm">
      <Link href={section.href}>{section.label}</Link>
    </Button>
  ));
}

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
  // Controlled, so choosing a link closes the menu: a Radix popover stays open across a
  // client-side navigation otherwise, hanging over the page it just opened.
  const [open, setOpen] = useState(false);
  // What this person may do in the page's language. Only that one: a Portuguese translator
  // on an English page is a member there, and is offered what a member is.
  const may = useCan();

  // Rendering nothing until the session resolves avoids a "Sign in" flash for a user who
  // is in fact signed in.
  if (isPending) return null;

  if (!session) {
    return (
      <nav className="flex items-center gap-1">
        <Sections />
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
  // Everything only a signed-in person can reach, in one menu rather than a header row that
  // grew a button per role until it wrapped.
  const links = [
    canManageVoices(role) && { href: "/voices", label: "Voices" },
    // Each of these is the page's language's own, and gated on the same capability there as
    // the page it opens -- so a link is never offered to a page that would answer 404.
    may("configure") && { href: "/lexicon", label: "Pronunciation" },
    may("edit") && { href: "/reports", label: "Reports" },
    may("edit") && { href: "/contributions", label: "Contributions" },
    isAdmin(role) && { href: "/admin", label: "Users" },
    may("admin") && { href: "/translators", label: "Translators" },
    // Everyone signed in has one, and for a collaborator it is where the ElevenLabs key
    // lives - which is the thing standing between them and the Regenerate button.
    { href: "/profile", label: "Profile" },
  ].filter((link): link is { href: string; label: string } => Boolean(link));

  return (
    <nav className="flex items-center gap-1">
      <Sections />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="ml-1">
            Profile
          </Button>
        </PopoverTrigger>
        <PopoverContent className="flex w-56 flex-col gap-0.5 p-1.5">
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="text-muted-foreground truncate text-xs">{session.user.email}</span>
            <Badge variant="outline" className="uppercase">
              {role ?? "member"}
            </Badge>
          </div>
          {links.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm" className="justify-start">
              <Link href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </Link>
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            className="justify-start"
            onClick={() => {
              setOpen(false);
              signOut().then(() => router.refresh());
            }}
          >
            Sign out
          </Button>
        </PopoverContent>
      </Popover>
    </nav>
  );
}
