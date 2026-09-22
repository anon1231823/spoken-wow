// The zones half of the language list: which sound-pack folder a language ships in.
// What a language is -- its code, name, script and ElevenLabs code -- is shared with the
// site and the other pipelines, and lives in pipelines/lib/locales.mjs.
//
// Must stay in step with SpokenZones.LOCALES in addon/SpokenZones/Language.lua;
// tools/validate.mjs fails the build if the two lists drift, the same way it
// already guards NormaliseAreaKey.

import { BASE_LOCALE, CODES, LOCALES } from "../../../lib/locales.mjs";

// What the zones tools import from here; anything else about a language, from the source.
export { BASE_LOCALE, CODES, LOCALES };

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
 * exception, not a rewrite.
 *
 * This agreed with scripts/zones/package-audio.sh only by accident until now: that script
 * names a language's folder after its source directory, which the merge renamed, while this
 * still said ZoneLoreAudio_<locale>. Nothing caught it because no language pack has shipped.
 * The droplet directory is a third name again (make/zones.mk:REMOTE_SOUNDS_DIR) and stays
 * put -- it is a path on a server holding audio, not something a player installs.
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
  return "SpokenZonesAudio_" + locale;
}

/** The tiers a language is packaged at. See packFolder for why English differs. */
export function tiersFor(locale) {
  return locale === BASE_LOCALE ? ["high", "standard"] : ["standard"];
}
