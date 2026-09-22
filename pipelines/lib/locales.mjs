// The languages this project knows about, for every half of it: the zones and books
// pipelines and the site (apps/web/src/lib/lang.ts). What a language IS lives here; what
// one section does with it -- the folder a zones pack ships in, say -- lives with that
// section.
//
// Must stay in step with the addons' own lists (SpokenZones.LOCALES in
// addons/SpokenZones/Language.lua); pipelines/zones/tools/validate.mjs fails the build if
// they drift, and apps/web/src/lib/lang.test.ts does the same for the site.

export const BASE_LOCALE = "enUS";

// `script` is what a client's fonts must be able to draw -- the addon uses it to
// hide a language a player's client would render as boxes.
//
// `elevenLabs` is the language_code sent with a synthesis request: ISO 639-1, which
// is what the multilingual models take. It names the language, not the region, so
// both Spanishes say "es" and both Chineses say "zh" -- the voice picked for each
// carries the accent. Sent so a short line does not leave the model to guess the
// language from a handful of proper nouns.
//
// `bcp47` is what a page in the language declares in <html lang>, so a screen reader and a
// browser's translate prompt know what they are looking at.
//
// `vmangos` is the N in the world database's *_locN columns, or null for a language the
// dump carries no text for. Portuguese and Italian are the cases that matter: a pack may be
// recorded in either, but their text has to be written rather than extracted.
export const LOCALES = [
  { code: "enUS", name: "English", script: "latin", elevenLabs: "en", bcp47: "en-US", vmangos: 0 },
  { code: "deDE", name: "German", script: "latin", elevenLabs: "de", bcp47: "de-DE", vmangos: 3 },
  { code: "esES", name: "Spanish (EU)", script: "latin", elevenLabs: "es", bcp47: "es-ES", vmangos: 6 },
  { code: "esMX", name: "Spanish (AL)", script: "latin", elevenLabs: "es", bcp47: "es-MX", vmangos: 7 },
  { code: "frFR", name: "French", script: "latin", elevenLabs: "fr", bcp47: "fr-FR", vmangos: 2 },
  { code: "itIT", name: "Italian", script: "latin", elevenLabs: "it", bcp47: "it-IT", vmangos: null },
  { code: "ptBR", name: "Portuguese", script: "latin", elevenLabs: "pt", bcp47: "pt-BR", vmangos: null },
  { code: "ruRU", name: "Russian", script: "cyrillic", elevenLabs: "ru", bcp47: "ru-RU", vmangos: 8 },
  { code: "koKR", name: "Korean", script: "korean", elevenLabs: "ko", bcp47: "ko-KR", vmangos: 1 },
  { code: "zhCN", name: "Chinese (S)", script: "simplifiedchinese", elevenLabs: "zh", bcp47: "zh-CN", vmangos: 4 },
  { code: "zhTW", name: "Chinese (T)", script: "traditionalchinese", elevenLabs: "zh", bcp47: "zh-TW", vmangos: 5 },
];

export const CODES = LOCALES.map((l) => l.code);

export function localeInfo(code) {
  return LOCALES.find((l) => l.code === code) || null;
}

export function isLocale(code) {
  return CODES.includes(code);
}

/** The language_code a synthesis request for this language sends. */
export function elevenLabsCode(locale) {
  return localeInfo(locale)?.elevenLabs ?? null;
}
