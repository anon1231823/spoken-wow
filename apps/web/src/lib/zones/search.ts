// Filtering, as a pure function of the catalogue.
//
// Everything database-backed arrives in a SearchContext rather than being fetched here,
// which is the split lib/search.ts makes on the quests side and the reason this is
// testable with no database and no filesystem. 1353 rows filter in a linear chain per
// request; there is no index and at this size there does not need to be one.
//
// THE STATE DEFINITIONS ARE THE CLI's. `missing`, `stale` and `current` mean exactly what
// pipelines/zones/tools/voice/generate.mjs's --missing and --stale select, because they
// are computed the same way: stale is take.textHash !== entry.hash, where entry.hash is
// sha1 of the SPOKEN text. If these two ever disagree, the explorer is lying about what
// needs regenerating.

import type { CatalogueEntry, LineFlag, SearchContext, Take } from "./catalogue";
import { PAGE_SIZE, SHORT_LINE, type LineFilters, type State } from "./filters";

export type ResultLine = {
  /** 'z:1411' | 's:1411:razor hill'. Unique by construction -- naming.mjs guarantees
   *  one file per line -- so unlike the quests side there is no positional row key. */
  id: string;
  kind: "zone" | "subzone";
  mapID: number;
  zoneName: string;
  /** The subzone's name, or the zone's own for a zone line. */
  name: string;
  text: string;
  spoken: string;
  chars: number;
  short: boolean;
  file: string;
  state: State;
  take: Take | null;
  flag: LineFlag | null;
  /** How many reports on this line are still open. The count is public; the bodies are
   *  not -- see SearchContext.reports. */
  reportsOpen: number;
  /** The English prose this line would be translated from. Absent when reading English. */
  english?: string;
  /** False when this language has no row for the line yet, so `text` is the English
   *  showing through. Absent when reading English, where the question is meaningless. */
  translated?: boolean;
};

export type SearchResult = {
  lines: ResultLine[];
  /** Across every page, not just this one. */
  total: number;
  /** What the current filter selects, for the header and the regenerate quote. */
  totalChars: number;
  counts: Record<State, number>;
  offset: number;
  limit: number;
};

export function stateOf(entry: CatalogueEntry, take: Take | undefined): State {
  if (!take) return "missing";
  return take.textHash === entry.hash ? "current" : "stale";
}

export function decorate(entry: CatalogueEntry, context: SearchContext): ResultLine {
  const take = context.takes.get(entry.id);
  return {
    id: entry.id,
    kind: entry.kind,
    mapID: entry.mapID,
    zoneName: entry.zoneName,
    name: entry.name || entry.key || entry.zoneName,
    text: entry.full,
    spoken: entry.spoken,
    chars: entry.spoken.length,
    short: entry.spoken.length < SHORT_LINE,
    file: entry.file,
    state: stateOf(entry, take),
    take: take ?? null,
    flag: context.flags.get(entry.id) ?? null,
    reportsOpen: context.reports.get(entry.id) ?? 0,
  };
}

function dayStart(day: string): number | null {
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) ? null : at;
}

function matchesQuery(line: ResultLine, needle: string, field: string): boolean {
  const q = needle.toLowerCase();
  switch (field) {
    case "name":
      return line.name.toLowerCase().includes(q);
    case "zone":
      return line.zoneName.toLowerCase().includes(q);
    case "text":
      return line.text.toLowerCase().includes(q);
    default:
      return (
        line.name.toLowerCase().includes(q) ||
        line.zoneName.toLowerCase().includes(q) ||
        line.text.toLowerCase().includes(q)
      );
  }
}

export function matching(lines: ResultLine[], filters: LineFilters = {}): ResultLine[] {
  let out = lines;

  if (filters.q) {
    const needle = filters.q.trim();
    if (needle) out = out.filter((l) => matchesQuery(l, needle, filters.field ?? "any"));
  }
  if (filters.kind) out = out.filter((l) => l.kind === filters.kind);
  if (filters.mapID !== undefined) out = out.filter((l) => l.mapID === filters.mapID);
  if (filters.state) out = out.filter((l) => l.state === filters.state);
  if (filters.short) out = out.filter((l) => l.short);

  if (filters.flag) {
    // 'unreviewed' is the absence of a row, not a status -- it is what makes a
    // listening pass finishable, so it has to be expressible as a filter.
    out =
      filters.flag === "unreviewed"
        ? out.filter((l) => l.flag === null)
        : out.filter((l) => l.flag?.status === filters.flag);
  }

  // The triage worklist, and the counterpart of `flag: 'bad'`: what somebody else has
  // complained about, as opposed to what an editor has already judged.
  if (filters.reports === "open") out = out.filter((l) => l.reportsOpen > 0);

  // An id the catalogue no longer carries matches nothing rather than everything: a report
  // about a line that has since been dropped must not read as "here it is".
  if (filters.line) out = out.filter((l) => l.id === filters.line);

  if (filters.modelId) out = out.filter((l) => l.take?.modelId === filters.modelId);

  if (filters.generatedAfter) {
    const at = dayStart(filters.generatedAfter);
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) >= at);
  }
  if (filters.generatedBefore) {
    const at = dayStart(filters.generatedBefore);
    // Exclusive of the named day's own generations: "before the 3rd" should not
    // include clips made at 09:00 on the 3rd.
    if (at !== null) out = out.filter((l) => l.take && Date.parse(l.take.generatedAt) < at);
  }

  return out;
}

// Deterministic and total, because paging a list whose order can shift drops and
// repeats rows between pages. Zone line first within a zone, then subzones by name.
function order(lines: ResultLine[]): ResultLine[] {
  return [...lines].sort(
    (a, b) =>
      a.zoneName.localeCompare(b.zoneName) ||
      Number(a.kind === "subzone") - Number(b.kind === "subzone") ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}

export function search(
  entries: CatalogueEntry[],
  context: SearchContext,
  filters: LineFilters = {},
  offset = 0,
  limit = PAGE_SIZE,
): SearchResult {
  const all = entries.map((entry) => decorate(entry, context));
  const matched = order(matching(all, filters));

  const counts: Record<State, number> = { missing: 0, stale: 0, current: 0 };
  let totalChars = 0;
  for (const line of matched) {
    counts[line.state]++;
    totalChars += line.chars;
  }

  return {
    lines: matched.slice(offset, offset + limit),
    total: matched.length,
    totalChars,
    counts,
    offset,
    limit,
  };
}
