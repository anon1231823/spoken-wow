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
// `elevenLabs` is the language_code sent with a synthesis request. Null means no
// decision has been made yet, which is every language but English: a multilingual
// model infers the language from the text when the code is absent, and guessing
// one here would be a generation decision made by a lookup table.
export const LOCALES = [
  { code: "enUS", name: "English", script: "latin", elevenLabs: "en" },
  { code: "deDE", name: "German", script: "latin", elevenLabs: null },
  { code: "esES", name: "Spanish (EU)", script: "latin", elevenLabs: null },
  { code: "esMX", name: "Spanish (AL)", script: "latin", elevenLabs: null },
  { code: "frFR", name: "French", script: "latin", elevenLabs: null },
  { code: "itIT", name: "Italian", script: "latin", elevenLabs: null },
  { code: "ptBR", name: "Portuguese", script: "latin", elevenLabs: null },
  { code: "ruRU", name: "Russian", script: "cyrillic", elevenLabs: null },
  { code: "koKR", name: "Korean", script: "korean", elevenLabs: null },
  { code: "zhCN", name: "Chinese (S)", script: "simplifiedchinese", elevenLabs: null },
  { code: "zhTW", name: "Chinese (T)", script: "traditionalchinese", elevenLabs: null },
];

export const CODES = LOCALES.map((l) => l.code);

export function localeInfo(code) {
  return LOCALES.find((l) => l.code === code) || null;
}

export function isLocale(code) {
  return CODES.includes(code);
}

/**
 * The addon folder a language's sound pack ships in.
 *
 * English keeps the two folder names already published on CurseForge; renaming
 * either would orphan every installation. Other languages ship one VBR tier, so
 * their folder carries no bitrate marker -- if a second tier is ever wanted for
 * a language, it needs a suffix and this rule gets an exception, not a rewrite.
 */
export function packFolder(locale, tier = "standard") {
  if (locale === BASE_LOCALE) {
    return tier === "high" ? "ZoneLoreAudio" : "ZoneLoreAudio64";
  }
  return "ZoneLoreAudio" + locale.slice(0, 2).toUpperCase();
}

/** The tiers a language is packaged at. See packFolder for why English differs. */
export function tiersFor(locale) {
  return locale === BASE_LOCALE ? ["high", "standard"] : ["standard"];
}
