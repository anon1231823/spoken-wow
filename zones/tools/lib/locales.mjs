// The languages ZoneLore knows about, and the naming rules that follow from a
// language: which sound-pack folder it ships in, and what code ElevenLabs wants.
//
// Must stay in step with ZoneLore.LOCALES in addon/ZoneLore/Language.lua;
// tools/validate.mjs fails the build if the two lists drift, the same way it
// already guards NormaliseAreaKey.

export const BASE_LOCALE = "enUS";

// `script` is what a client's fonts must be able to draw -- the addon uses it to
// hide a language a player's client would render as boxes.
//
// `elevenLabs` is the language_code sent with a synthesis request: ISO 639-1, which
// is what the multilingual models take. It names the language, not the region, so
// both Spanishes say "es" and both Chineses say "zh" -- the voice picked for each
// carries the accent. Sent so a short line does not leave the model to guess the
// language from a handful of proper nouns.
export const LOCALES = [
  { code: "enUS", name: "English", script: "latin", elevenLabs: "en" },
  { code: "deDE", name: "German", script: "latin", elevenLabs: "de" },
  { code: "esES", name: "Spanish (EU)", script: "latin", elevenLabs: "es" },
  { code: "esMX", name: "Spanish (AL)", script: "latin", elevenLabs: "es" },
  { code: "frFR", name: "French", script: "latin", elevenLabs: "fr" },
  { code: "itIT", name: "Italian", script: "latin", elevenLabs: "it" },
  { code: "ptBR", name: "Portuguese", script: "latin", elevenLabs: "pt" },
  { code: "ruRU", name: "Russian", script: "cyrillic", elevenLabs: "ru" },
  { code: "koKR", name: "Korean", script: "korean", elevenLabs: "ko" },
  { code: "zhCN", name: "Chinese (S)", script: "simplifiedchinese", elevenLabs: "zh" },
  { code: "zhTW", name: "Chinese (T)", script: "traditionalchinese", elevenLabs: "zh" },
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

/**
 * The addon folder a language's sound pack ships in.
 *
 * English keeps the two folder names already published on CurseForge; renaming
 * either would orphan every installation. Other languages ship one VBR tier, so
 * their folder carries no bitrate marker -- if a second tier is ever wanted for
 * a language, it needs a suffix and this rule gets an exception, not a rewrite.
 *
 * THE FULL LOCALE CODE, never a truncation: "es" would make esES and esMX one
 * folder, and the collision would be silent -- take filenames are identical
 * across languages, so one pack's files would simply replace the other's and
 * every validator would keep passing.
 */
export function packFolder(locale, tier = "standard") {
  if (locale === BASE_LOCALE) {
    return tier === "high" ? "ZoneLoreAudio" : "ZoneLoreAudio64";
  }
  return "ZoneLoreAudio_" + locale;
}

/** The tiers a language is packaged at. See packFolder for why English differs. */
export function tiersFor(locale) {
  return locale === BASE_LOCALE ? ["high", "standard"] : ["standard"];
}
