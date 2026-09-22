"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import { localeHref } from "@/lib/lang";

import { useLang } from "./LangProvider";

/**
 * next/link, in the page's language.
 *
 * A drop-in for every internal link, so a link written as "/quests" stays on the language
 * the reader chose rather than dropping them back into English. English hrefs pass through
 * untouched, and so does anything that is not a path on this site.
 */
export default function LocaleLink({ href, ...props }: ComponentProps<typeof Link>) {
  const lang = useLang();
  return <Link href={typeof href === "string" ? localeHref(lang, href) : href} {...props} />;
}
