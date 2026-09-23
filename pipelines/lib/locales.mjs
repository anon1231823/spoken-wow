// The languages this project knows about, for every half of it: the zones and books
// pipelines and the site (apps/web/src/lib/lang.ts). What a language IS lives here; what
// one section does with it -- the folder a zones pack ships in, say -- lives with that
// section.
//
// Must stay in step with the addons' own lists (SpokenZones.LOCALES in
// addons/SpokenZones/Language.lua); pipelines/zones/tools/validate.mjs fails the build if
// they drift, and apps/web/src/lib/lang.test.ts does the same for the site.
//
// The clients the Classic-family addons run on, and no others. Italian was here and went on
// 2026-09-23: no Classic client has ever shipped it, so no player could run it and no
// vanilla-era Italian text or audio exists to import.

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
// dump carries no text for. Portuguese is the case that matters: the Classic Era client ships
// it, but 1.12 never did, so its text comes from elsewhere or is written on the site.
export const LOCALES = [
  { code: "enUS", name: "English", script: "latin", elevenLabs: "en", bcp47: "en-US", vmangos: 0 },
  { code: "deDE", name: "German", script: "latin", elevenLabs: "de", bcp47: "de-DE", vmangos: 3 },
  { code: "esES", name: "Spanish (EU)", script: "latin", elevenLabs: "es", bcp47: "es-ES", vmangos: 6 },
  { code: "esMX", name: "Spanish (AL)", script: "latin", elevenLabs: "es", bcp47: "es-MX", vmangos: 7 },
  { code: "frFR", name: "French", script: "latin", elevenLabs: "fr", bcp47: "fr-FR", vmangos: 2 },
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
