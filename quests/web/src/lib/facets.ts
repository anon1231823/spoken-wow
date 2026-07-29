/**
 * The values the filter dropdowns can offer.
 *
 * Derived from the corpus rather than listed here, for the same reason voiceSlots is
 * (lib/voices/slots.ts): races and voices are decided upstream in tts_cli/consts.py, and a
 * hardcoded list would quietly stop offering one the day it is added.
 *
 * Being a closed set derived from data also makes it a whitelist, which is what lets
 * /api/search take these straight from a query string.
 *
 * `source` and `npcType` are absent on purpose: they are closed unions on CorpusLine, so
 * their lists live next to the type in lib/search.ts.
 */
import { loadCorpus } from "./corpus";

export type Facets = {
  races: string[];
  genders: string[];
  voices: string[];
};

export function buildFacets(): Facets {
  const races = new Set<string>();
  const genders = new Set<string>();
  const voices = new Set<string>();

  for (const line of loadCorpus().lines) {
    races.add(line.race);
    genders.add(line.gender);
    voices.add(line.voice);
  }

  const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return { races: sorted(races), genders: sorted(genders), voices: sorted(voices) };
}

const cacheKey = Symbol.for("wow-voiceover.facets");
type CacheHolder = { [cacheKey]?: Facets };

export function facets(): Facets {
  const holder = globalThis as CacheHolder;
  if (!holder[cacheKey]) holder[cacheKey] = buildFacets();
  return holder[cacheKey]!;
}
