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
import type { CorpusLine } from "./corpus";
import { corpus } from "./quests/catalogue";

export type Facets = {
  races: string[];
  genders: string[];
  flavors: string[];
  voices: string[];
  /**
   * Every race/gender/flavor the corpus actually pairs.
   *
   * A flavor belongs to a race-gender - only tauren, troll and orc have a shaman voice, and
   * only night elves a priestess - so offering all fifty against a chosen race would mostly
   * offer ways to select nothing. Carried as triples rather than a map keyed by race-gender
   * so a partial selection (a race with no gender) narrows by the same filter.
   */
  flavorScopes: { race: string; gender: string; flavor: string }[];
};

export function buildFacets(lines: CorpusLine[]): Facets {
  const races = new Set<string>();
  const genders = new Set<string>();
  const flavors = new Set<string>();
  const voices = new Set<string>();
  const scopes = new Map<string, { race: string; gender: string; flavor: string }>();

  for (const line of lines) {
    races.add(line.race);
    genders.add(line.gender);
    voices.add(line.voice);
    // Null for narrator-male and the odd model from a later expansion, which have no NPC
    // voice sets to choose between. Nothing to offer, so nothing is added.
    if (!line.flavor) continue;
    flavors.add(line.flavor);
    scopes.set(line.voice, { race: line.race, gender: line.gender, flavor: line.flavor });
  }

  const sorted = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return {
    races: sorted(races),
    genders: sorted(genders),
    flavors: sorted(flavors),
    voices: sorted(voices),
    flavorScopes: [...scopes.values()].sort(
      (a, b) =>
        a.race.localeCompare(b.race) ||
        a.gender.localeCompare(b.gender) ||
        a.flavor.localeCompare(b.flavor),
    ),
  };
}

const cacheKey = Symbol.for("wow-voiceover.facets");
type CacheHolder = { [cacheKey]?: { lines: CorpusLine[]; facets: Facets } };

/**
 * Tied to the identity of the lines it was built from, which is how every memo over the
 * catalogue works now: the corpus is a table, so the facets move when somebody edits a
 * line's voice, and a permanent memo would keep offering a race nothing is spoken in.
 */
export async function facets(): Promise<Facets> {
  const lines = (await corpus()).lines;
  const holder = globalThis as CacheHolder;

  if (!holder[cacheKey] || holder[cacheKey].lines !== lines) {
    holder[cacheKey] = { lines, facets: buildFacets(lines) };
  }
  return holder[cacheKey].facets;
}
