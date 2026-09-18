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
 * The directory a language's sound pack lives in IN THIS REPOSITORY.
 *
 * Not the same thing as packFolder, and the difference has already caused one silent
 * disagreement: deriving a repo path from the published name left soundsDir() pointing at
 * addons/ZoneLoreAudio/Sounds, which did not exist, while `make zones-pull` filled
 * addons/SpokenZonesAudio/Sounds, which did. Nothing noticed, because the droplet sets
 * SPOKEN_ZONES_SOUNDS and local runs had no audio pulled. English's two names agree again
 * now that the published folder is SpokenZonesAudio, but a language's do not, so the two
 * functions stay separate.
 *
 * scripts/zones/package-audio.sh has always drawn this line -- it rsyncs from the source
 * directory into a staging folder named for the published one. This is that same line,
 * available to the Node tools.
 */
export function sourceFolder(locale) {
  return locale === BASE_LOCALE ? "SpokenZonesAudio" : `SpokenZonesAudio_${locale}`;
}

/**
 * The addon folder a language's sound pack ships in, as installed by a player.
 *
 * English's high tier was renamed from ZoneLoreAudio with the projects, which costs a
 * re-download and nothing else: a pack's own Sounds.lua reads its folder name out of the
 * loader, so no path is baked in. ZoneLoreAudio64 keeps its name because it is retired --
 * nothing builds it, and the name is only here to describe what players still have.
 *
 * Other languages ship one VBR tier, so their folder carries no bitrate marker -- if a
 * second tier is ever wanted for a language, it needs a suffix and this rule gets an
 * exception, not a rewrite. Their folders keep the ZoneLoreAudio_ prefix, which is also
 * the directory name on the droplet (make/zones.mk:REMOTE_SOUNDS_DIR); renaming those is a
 * move of several hundred megabytes on a server for no gain, since no language pack has a
 * CurseForge project yet.
 *
 * THE FULL LOCALE CODE, never a truncation: "es" would make esES and esMX one
 * folder, and the collision would be silent -- take filenames are identical
 * across languages, so one pack's files would simply replace the other's and
 * every validator would keep passing.
 */
export function packFolder(locale, tier = "standard") {
  if (locale === BASE_LOCALE) {
    return tier === "high" ? "SpokenZonesAudio" : "ZoneLoreAudio64";
  }
  return "ZoneLoreAudio_" + locale;
}

/** The tiers a language is packaged at. See packFolder for why English differs. */
export function tiersFor(locale) {
  return locale === BASE_LOCALE ? ["high", "standard"] : ["standard"];
}
