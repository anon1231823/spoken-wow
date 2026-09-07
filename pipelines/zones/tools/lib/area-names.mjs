// What the client calls each place, in each language.
//
// tools/seed/area-names.json is written by tools/locale/build-aliases.mjs from the
// same AreaTable join that builds the alias tables: for every corpus key -- a
// subzone's normalised English name, or a zone's -- the name a client in that
// locale shows. Nobody translates a place name here; the client already did, and
// a translation that disagreed with the map would read as a mistake.
//
// The web catalogue draws the Zone column, the dropdown and every row's name from
// this whatever language is being read, translated or not; the writers of
// translated rows (saveLore, recordTranslations) store the same name, so an
// exported Subzones.lua lists places as the client does. A key with no entry --
// the name is the same in both languages, or the locale has no Era translation --
// falls back to English, which is what such a client shows anyway.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { BASE_LOCALE } from "./locales.mjs";
import { normaliseKey, ROOT } from "./wiki.mjs";

export const AREA_NAMES_PATH = join(ROOT, "pipelines/zones/tools/seed/area-names.json");

let loaded = null;

/** { deDE: Map<key, name>, ... }. Missing file: every language empty. */
export async function loadAreaNames() {
  if (loaded) return loaded;
  loaded = readFile(AREA_NAMES_PATH, "utf8")
    .then((text) => {
      const json = JSON.parse(text);
      const out = {};
      for (const [locale, names] of Object.entries(json.names ?? {})) {
        out[locale] = new Map(Object.entries(names));
      }
      return out;
    })
    .catch((err) => {
      if (err.code === "ENOENT") return {};
      throw err;
    });
  return loaded;
}

/** The corpus key a place's name is looked up under: a subzone's key, or a zone's name. */
export function areaKeyOf(entry) {
  return entry.kind === "zone" ? normaliseKey(entry.name) : entry.key;
}

/**
 * The client's name for a place in `lang`, or `englishName` when it has none.
 * `entry` needs kind, key and (for a zone) its English name.
 */
export function areaName(names, lang, entry, englishName = entry.name) {
  if (lang === BASE_LOCALE) return englishName;
  return names[lang]?.get(areaKeyOf(entry)) ?? englishName;
}
