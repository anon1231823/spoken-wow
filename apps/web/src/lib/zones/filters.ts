// The zones filter vocabulary, and its translation to and from a query string.
//
// CLIENT-SAFE ON PURPOSE. The catalogue reaches the pipeline, which reads the filesystem,
// so a client component cannot import a *value* from it -- types cross freely, runtime
// code does not. Everything both sides need lives here. lib/line-fields.ts is the quests
// side's version of the same rule.

export const FIELDS = ["any", "name", "zone", "text"] as const;
export const KINDS = ["zone", "subzone"] as const;
export const STATES = ["missing", "stale", "current"] as const;
export const FLAGS = ["bad", "ok", "unreviewed"] as const;
// One value rather than a boolean, so "resolved" or "any" can be added without changing
// the shape of the URL that is already out there in shared links.
export const REPORTS = ["open"] as const;

export type Field = (typeof FIELDS)[number];
export type Kind = (typeof KINDS)[number];
/** missing = no audio; stale = audio predates a text change; current = neither. */
export type State = (typeof STATES)[number];
export type Flag = (typeof FLAGS)[number];
export type Reports = (typeof REPORTS)[number];

export type LineFilters = {
  q?: string;
  /** Which field the free-text query is matched against. */
  field?: Field;
  kind?: Kind;
  /** uiMapID. Selects a zone's own line and all of its subzones. */
  mapID?: number;
  state?: State;
  /** Under 250 spoken characters, where eleven_v3 is documented as least reliable. */
  short?: boolean;
  /** 'unreviewed' means no flag row at all -- what is left to listen to. */
  flag?: Flag;
  /** 'open' selects lines carrying at least one unresolved report. */
  reports?: Reports;
  /** One catalogue id, which is how a report on /reports links into this explorer. */
  line?: string;
  generatedBefore?: string; // YYYY-MM-DD
  generatedAfter?: string;
  /** Lines cut with a model the generation settings have since moved off. */
  modelId?: string;
};

// Below this, ElevenLabs documents v3 as unreliable, and 305 of the 1353 entries are
// shorter. Kept in step with SHORT_LINE in tools/voice/generate.mjs, which marks the
// same lines in the CLI's listing.
export const SHORT_LINE = 250;

export const PAGE_SIZE = 100;

// Short keys, because the whole filter set rides in the URL and a shared link should
// stay readable.
export function filterParams(filters: LineFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.field && filters.field !== "any") params.set("field", filters.field);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.mapID !== undefined) params.set("zone", String(filters.mapID));
  if (filters.state) params.set("state", filters.state);
  if (filters.short) params.set("short", "1");
  if (filters.flag) params.set("flag", filters.flag);
  if (filters.reports) params.set("fb", filters.reports);
  if (filters.line) params.set("line", filters.line);
  if (filters.generatedBefore) params.set("before", filters.generatedBefore);
  if (filters.generatedAfter) params.set("after", filters.generatedAfter);
  if (filters.modelId) params.set("model", filters.modelId);
  return params;
}

// Every closed set is validated against its constant rather than trusted, so a
// hand-edited URL produces "no filter" instead of a filter nothing can match -- which
// would look like an empty result set and read as missing data.
function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function filtersFromParams(params: URLSearchParams): LineFilters {
  const mapID = Number(params.get("zone"));
  const before = params.get("before");
  const after = params.get("after");

  return {
    q: params.get("q") ?? undefined,
    field: oneOf(params.get("field"), FIELDS),
    kind: oneOf(params.get("kind"), KINDS),
    mapID: Number.isFinite(mapID) && mapID > 0 ? mapID : undefined,
    state: oneOf(params.get("state"), STATES),
    short: params.get("short") === "1" || undefined,
    flag: oneOf(params.get("flag"), FLAGS),
    reports: oneOf(params.get("fb"), REPORTS),
    line: params.get("line") || undefined,
    generatedBefore: before && DATE.test(before) ? before : undefined,
    generatedAfter: after && DATE.test(after) ? after : undefined,
    modelId: params.get("model") ?? undefined,
  };
}

// Powers the "Clear all N filters" button, which is all it is for.
//
// The free-text query counts: a "clear all" that left it in force would lie about
// what you are looking at. `field` does not count on its own -- it only says where the
// query matches, and on its own narrows nothing -- but clearing still resets it.
export function activeFilterCount(filters: LineFilters): number {
  return [
    filters.q,
    filters.kind,
    filters.mapID,
    filters.state,
    filters.short,
    filters.flag,
    filters.reports,
    filters.line,
    filters.generatedBefore,
    filters.generatedAfter,
    filters.modelId,
  ].filter(Boolean).length;
}
