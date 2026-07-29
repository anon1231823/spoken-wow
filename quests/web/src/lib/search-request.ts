/**
 * Reading filters off a query string.
 *
 * Shared by /api/search and /api/search/lines so a page and the batch it offers to
 * regenerate can never disagree about what "matching" means.
 *
 * Unknown values are dropped rather than rejected: every one of these comes from a closed
 * set (lib/facets.ts, and the unions in lib/search.ts), so anything else is a stale link or
 * a hand-edited URL, and answering it with the unfiltered corpus is both safe and more
 * useful than a 400.
 */
import { facets } from "./facets";
import { NPC_TYPES, SOURCES } from "./line-fields";
import type { Filter, LineFilters } from "./search";

const FILTERS: Filter[] = ["any", "npc", "quest", "text"];

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function filtersFromParams(params: URLSearchParams): LineFilters {
  const { races, genders, voices } = facets();

  return {
    q: params.get("q") ?? "",
    filter: oneOf(params.get("filter"), FILTERS) ?? "any",
    missingOnly: params.get("missing") === "1",
    race: oneOf(params.get("race"), races),
    gender: oneOf(params.get("gender"), genders),
    voice: oneOf(params.get("voice"), voices),
    source: oneOf(params.get("source"), SOURCES),
    npcType: oneOf(params.get("type"), NPC_TYPES),
  };
}
