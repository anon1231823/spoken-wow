"use client";

import Link from "next/link";

import { useLang } from "@/lib/use-lang";

/**
 * "Home" is the explorer, which lives under a language.
 *
 * A bare href="/" would still work -- app/page.tsx redirects it to English -- but it
 * would quietly drop a translator back into English every time they clicked the
 * wordmark, and cost them a redirect to do it.
 */
export function HomeLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { lang } = useLang();
  return (
    <Link href={`/${lang}`} className={className}>
      {children}
    </Link>
  );
}
