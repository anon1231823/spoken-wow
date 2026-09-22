"use client";

import { createContext, useContext } from "react";

import { BASE_LANG, type Lang } from "@/lib/lang";

/**
 * The page's language, for client components.
 *
 * From the layout rather than read off usePathname, which reports the address the browser
 * shows: an English page is served at /quests with no prefix at all, and would be
 * indistinguishable from a path that simply has no language.
 */
const LangContext = createContext<Lang>(BASE_LANG);

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}
