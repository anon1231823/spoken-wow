/**
 * Which language a zones line is written in.
 *
 * CLIENT-SAFE: a filter or a badge may need the list as a value, and everything that
 * resolves a language to a path reaches the pipeline, which reads the filesystem.
 *
 * THE SITE SERVES ENGLISH, AND THE LIBRARY STILL TAKES A LANGUAGE. The zones site had a
 * selector in its header and eleven locales behind it; this one has neither yet, and
 * postponing that was a deliberate decision when the two sites merged. What was not
 * decided is to throw the language away: `lore_line`, `line_flag`, `report` and `take` all
 * carry it, the rows being imported at cutover carry it, and the non-English sound packs
 * are still built from those rows by the CLI. So every query below the surface names its
 * language and every route above it passes BASE_LANG. Adding the selector back is a
 * change to the edges rather than an excavation.
 *
 * Kept in step with LOCALES in pipelines/zones/tools/lib/locales.mjs and in
 * addons/SpokenZones/Language.lua; pipelines/zones/tools/validate.mjs fails the build if
 * the three drift.
 */
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

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (CODES as readonly string[]).includes(value);
}
