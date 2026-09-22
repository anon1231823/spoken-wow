/**
 * Which language a page, a query or a take is in.
 *
 * CLIENT-SAFE: the header's switcher and every URL builder need the list as a value, and
 * the proxy validates a URL prefix against it without reaching the database. Whether a
 * language is switched ON is a different question with a different answer at runtime -- the
 * `language` table -- and is asked on the server.
 *
 * THE SAME LIST AS pipelines/lib/locales.mjs, restated here as a literal so the type of a
 * code is the eleven codes rather than `string`. lang.test.ts fails if the two drift, the way
 * pipelines/zones/tools/validate.mjs guards the addon's copy.
 *
 * It was here before as lib/zones/lang.ts, and went when zones lost its language axis in
 * 4939d3f because nothing had been translated. It comes back for all three sections at once.
 */
export const LOCALES = [
  { code: "enUS", name: "English", bcp47: "en-US" },
  { code: "deDE", name: "German", bcp47: "de-DE" },
  { code: "esES", name: "Spanish (EU)", bcp47: "es-ES" },
  { code: "esMX", name: "Spanish (AL)", bcp47: "es-MX" },
  { code: "frFR", name: "French", bcp47: "fr-FR" },
  { code: "itIT", name: "Italian", bcp47: "it-IT" },
  { code: "ptBR", name: "Portuguese", bcp47: "pt-BR" },
  { code: "ruRU", name: "Russian", bcp47: "ru-RU" },
  { code: "koKR", name: "Korean", bcp47: "ko-KR" },
  { code: "zhCN", name: "Chinese (S)", bcp47: "zh-CN" },
  { code: "zhTW", name: "Chinese (T)", bcp47: "zh-TW" },
] as const;

export type Lang = (typeof LOCALES)[number]["code"];

export const CODES: readonly Lang[] = LOCALES.map((locale) => locale.code);

/**
 * English: what every other language is translated from, what line ids and file names are
 * derived from, and what a bare URL means.
 */
export const BASE_LANG: Lang = "enUS";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (CODES as readonly string[]).includes(value);
}

export function langName(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.name ?? lang;
}

export function langTag(lang: Lang): string {
  return LOCALES.find((locale) => locale.code === lang)?.bcp47 ?? "en-US";
}
