"use client";

import { Languages } from "lucide-react";

import { LOCALES, type Lang } from "@/lib/lang";
import { useLang } from "@/lib/use-lang";

/**
 * The site-wide language switch.
 *
 * Every language is listed, including the ones nothing has been written in: choosing an
 * empty one is how a translation starts. What is *finished* is a question for the addon,
 * which hides a language from players until it is complete -- this is the workbench, and
 * a workbench that only offered finished work would be useless.
 */
export function LangSelect() {
  const { lang, hasLang, setLang } = useLang();

  // Hidden on the pages that mean the same thing in every language. A switch that
  // changed nothing would be a control that looks broken.
  if (!hasLang) return null;

  return (
    <label className="flex items-center gap-1 text-muted" title="Language">
      <Languages className="h-4 w-4" aria-hidden />
      <select
        value={lang}
        onChange={(event) => setLang(event.target.value as Lang)}
        aria-label="Language"
        className="bg-transparent"
      >
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.name}
          </option>
        ))}
      </select>
    </label>
  );
}
