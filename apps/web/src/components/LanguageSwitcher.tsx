"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { localeHref, stripLang, type Lang } from "@/lib/lang";

import { useLang } from "./LangProvider";

type Offered = { code: Lang; name: string; enabled: boolean };

/**
 * The site's one language switch.
 *
 * Moves the page the reader is on to the same page in another language -- same path, same
 * query -- rather than to the landing page, since a switch that loses the search a reader
 * just ran is a switch nobody uses twice.
 *
 * Asked of the API in the browser rather than read by the layout, for the reason UserMenu
 * reads the session there: the layout would otherwise put a query in front of every English
 * page. Renders nothing while only one language is on, which is the site as it stands.
 */
export default function LanguageSwitcher() {
  const lang = useLang();
  const pathname = usePathname();
  const router = useRouter();
  const [offered, setOffered] = useState<Offered[]>([]);

  useEffect(() => {
    let live = true;
    fetch("/api/languages")
      .then((response) => (response.ok ? response.json() : { languages: [] }))
      .then((body: { languages: Offered[] }) => {
        if (live) setOffered(body.languages);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (offered.length < 2) return null;

  function choose(next: string) {
    const here = `${stripLang(pathname).path}${window.location.search}`;
    router.push(localeHref(next as Lang, here));
  }

  return (
    <Select value={lang} onValueChange={choose}>
      <SelectTrigger size="sm" className="w-36" aria-label="Language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {offered.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {language.name}
            {language.enabled ? "" : " (off)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
