// Which language the explorer is looking at.
//
// CLIENT-SAFE, for the reason filters.ts is: the selector is a client component and
// needs the list of languages as a *value*, while everything that resolves a language
// to a path or a query reaches tools/voice/*.mjs, which reads the filesystem.
//
// Deliberately not part of LineFilters. A filter narrows a set of lines; a language
// changes which corpus is being looked at, so "clear all filters" must not reset it
// and the filter count must not include it.
//
// Kept in step with LOCALES in tools/lib/locales.mjs and in addon/ZoneLore/Language.lua;
// tools/validate.mjs fails the build if the three drift.

export const LOCALES = [
  { code: "enUS", name: "English" },
  { code: "deDE", name: "German" },
  { code: "esES", name: "Spanish (EU)" },
  { code: "esMX", name: "Spanish (AL)" },
  { code: "frFR", name: "French" },
  { code: "itIT", name: "Italian" },
  { code: "ptBR", name: "Portuguese" },
  { code: "ruRU", name: "Russian" },
  { code: "koKR", name: "Korean" },
  { code: "zhCN", name: "Chinese (S)" },
  { code: "zhTW", name: "Chinese (T)" },
] as const;

export type Lang = (typeof LOCALES)[number]["code"];

export const CODES: Lang[] = LOCALES.map((locale) => locale.code);

/** English is the corpus every other language is translated from. */
export const BASE_LANG: Lang = "enUS";

/**
 * Where the site's own choice of language lives.
 *
 * A cookie rather than the URL: the switch is in the header and applies to every page,
 * including the ones with no query string to put it in. The APIs still read ?lang= --
 * that is how the addon's Report links say which language a player was reading, and it
 * has to work for somebody who has never opened the site before.
 */
export const LANG_COOKIE = "zonelore_lang";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && LOCALES.some((locale) => locale.code === value);
}

/**
 * The language a request is about.
 *
 * An unrecognised code falls back to English rather than erroring: the language rides
 * in the URL, and a mistyped one should show the corpus that certainly exists instead
 * of a page that will not load.
 */
export function langFromParams(params: URLSearchParams): Lang {
  const value = params.get("lang");
  return isLang(value) ? value : BASE_LANG;
}

export function langName(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.name ?? lang;
}
