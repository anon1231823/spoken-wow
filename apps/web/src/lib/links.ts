/**
 * Where one page sends you to another.
 *
 * Here rather than inline at each call site because these are the links the merge broke:
 * the quests explorer used to be the site root, so /issues and /lexicon both pointed at
 * `/?q=…`, and after the move that address is the landing page - which renders, shows two
 * links and no results, and reports no error at all. A dead deep link that still returns
 * 200 is the kind a build cannot catch, so the addresses live in one tested module.
 */

import type { Source } from "@/lib/reports/reports";

/** Which field a free-text query is matched against. Mirrors LineFilters["filter"]. */
type Scope = "any" | "npc" | "quest" | "text";

/**
 * The quests explorer, narrowed.
 *
 * `finding` is an issue id, and it is the filter that matters: a text search cannot say
 * what such a link means, since the bare `--` finding and `Hearthglen--you'll` are two
 * findings whose text both contains `--`. `q` is what the search box then shows, so the
 * page says what it is showing rather than presenting a narrowed list with an empty box.
 */
export function questsHref(options: { q?: string; filter?: Scope; finding?: number }): string {
  const params = new URLSearchParams();
  if (options.finding !== undefined) params.set("finding", String(options.finding));
  if (options.q !== undefined) params.set("q", options.q);
  if (options.filter !== undefined) params.set("filter", options.filter);
  return params.size ? `/quests?${params}` : "/quests";
}

/** The zones explorer, narrowed to one zone. */
export function zonesHref(options: { q?: string; mapID?: number } = {}): string {
  const params = new URLSearchParams();
  if (options.mapID !== undefined) params.set("zone", String(options.mapID));
  if (options.q !== undefined) params.set("q", options.q);
  return params.size ? `/zones?${params}` : "/zones";
}

/**
 * The page a reporter saw when they filed, for a report that carries an address.
 *
 * NOT the explorer with the line id in the search box, which is what this table used to
 * link to and which finds nothing: neither section's search matches an id. Quests matches
 * NPC names, quest titles, text and bare numbers; zones matches names, zones and text. The
 * landing page is the better destination anyway - it is the line, its audio and the report
 * form, which is what a triager wants to see.
 *
 * `target` is stored as the addon produced it: 'quest/84/accept' or 'npc/5678' for quests,
 * '<mapID>/<slug>' for zones, and a bare page id for books. All three are already
 * path-shaped, and each section's route takes exactly its own shape.
 */
export function reportHref(source: Source, target: string): string {
  return `/${source}/r/${target.split("/").map(encodeURIComponent).join("/")}`;
}

/** The lexicon editor, with this name already filled in. */
export function lexiconHref(grapheme: string): string {
  return `/lexicon?${new URLSearchParams({ grapheme })}`;
}
