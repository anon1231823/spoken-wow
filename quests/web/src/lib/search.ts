/**
 * Finding lines.
 *
 * Results are a flat, paged list of lines rather than a tree of NPCs, because the corpus is
 * 17,507 lines and the useful question is often "which line says this?", not "what does this
 * NPC say?". A flat list is also the only shape that can be paged: an NPC's lines are an
 * indivisible unit, so grouping first puts a floor under how much a page can cost.
 *
 * The npc and quest filters, and the voice filter, still mean what select_lines
 * (tts_cli/select.py) means by them, so "npc 240" reads the same on the CLI and in the
 * browser; search.test.ts is what keeps the two honest. Text, race, gender, source and
 * entity-type filtering are web-only and have no CLI counterpart to stay in step with.
 */
import type { Corpus, CorpusLine } from "./corpus";
import { npcKey } from "./corpus";
import { audioRelPath } from "./audio";
import type { NpcType, Source } from "./line-fields";
import { categoryGroup, type LineIssues, type Severity } from "./issues/issues";
import type { LineOverride } from "./issues/override";
import { isVoiceable } from "./text-gate";

/** Which field the free-text query is matched against. */
export type Filter = "any" | "npc" | "quest" | "text";

/**
 * Everything that narrows the corpus, with no bearing on which slice of the result is asked
 * for. Split out from paging because the batch endpoint needs the whole match set.
 */
export type LineFilters = {
  q?: string;
  filter?: Filter;
  missingOnly?: boolean;
  race?: string;
  gender?: string;
  flavor?: string;
  voice?: string;
  source?: Source;
  npcType?: NpcType;
  /**
   * "any" for a line with any open finding, or a severity meaning "this bad or worse".
   *
   * Worse-or-equal rather than exact, because the severity carried by a line is the worst of
   * however many findings touch it: asking for the ones that will break and being shown only
   * lines with nothing else wrong would be a strange thing to offer.
   */
  issues?: "any" | Severity;
  /** A category, or the group before its first hyphen. The dropdown offers groups. */
  issueCategory?: string;
  /** Lines whose spoken text has been rewritten by hand. */
  overridden?: boolean;
};

/**
 * What the corpus alone cannot say about a line: what is wrong with it, and what someone has
 * decided it should say instead.
 *
 * Passed in rather than read here, because both come from Postgres and this module is a pure
 * function of the corpus - which is what lets search.test.ts hold two corpora and no database.
 * Defaulted to empty so a caller that has neither still gets a search.
 */
export type SearchContext = {
  issues: Map<string, LineIssues>;
  overrides: Map<string, LineOverride>;
};

export const NO_CONTEXT: SearchContext = { issues: new Map(), overrides: new Map() };

export type SearchOptions = LineFilters & {
  offset?: number;
  limit?: number;
};

export type ResultLine = CorpusLine & {
  /** Unique row identity. See rowKeys - lineId is not unique, and neither is much else. */
  key: string;
  hasAudio: boolean;
  audioPath: string;
  /** Open findings on this line, worst severity first. Null when there are none. */
  issue: LineIssues | null;
  /** The rewritten spoken text, or null. `text` stays what the corpus says. */
  override: string | null;
  /**
   * Whether this line would be voiced *now*, which `generatable` cannot answer: that flag was
   * computed in Python from text nobody could edit yet, so an override that strips a stage
   * direction makes a line voiceable without moving it.
   */
  voiceable: boolean;
};

export type SearchResult = {
  /** This page only. */
  lines: ResultLine[];
  /** Matching lines across every page. */
  total: number;
  /** Distinct NPCs across every page, which no count of `lines` can recover. */
  npcCount: number;
  offset: number;
  limit: number;
};

export const PAGE_SIZE = 50;

/**
 * One unit of work in a batch regeneration.
 *
 * Deliberately not a ResultLine: a batch is the whole match set, which can be every line in
 * the corpus, and sending `text` and `originalText` for 17,507 of them to decide what a
 * button should cost is megabytes spent on two numbers and a label.
 */
export type BatchLine = {
  lineId: string;
  audioPath: string;
  npcName: string;
  voice: string;
  /** text.length, which is all the cost estimate needs. */
  characters: number;
  /** Enough of the line to recognise it in the progress readout. */
  preview: string;
};

/**
 * The lines a batch would actually generate.
 *
 * Deduplicated by audio file, because 1,076 files in the corpus are spoken by more than one
 * NPC and generating a shared file twice would pay for it twice and leave the second take
 * live. Lines the generator never voices are dropped here rather than failed one by one.
 */
export function batchJobs(
  lines: CorpusLine[],
  overrides: Map<string, LineOverride> = NO_CONTEXT.overrides,
): BatchLine[] {
  const byFile = new Map<string, BatchLine>();
  for (const line of lines) {
    const audioPath = audioRelPath(line);
    // The effective text, so the estimate prices what will actually be sent and a rescued
    // line is not quietly dropped from the batch that was quoted for it.
    const text = overrides.get(audioPath)?.text ?? line.text;
    if (!isVoiceable(line, text)) continue;
    if (byFile.has(audioPath)) continue;
    byFile.set(audioPath, {
      lineId: line.lineId,
      audioPath,
      npcName: line.npcName,
      voice: line.voice,
      characters: text.length,
      preview: text.slice(0, 80),
    });
  }
  return [...byFile.values()];
}

const keyCache = new WeakMap<Corpus, Map<CorpusLine, string>>();

/**
 * A unique key per corpus line, for React and for addressing a row in the DOM.
 *
 * Position in the corpus, because nothing carried by a line is unique. lineId is not: a
 * gossip lineId is a hash of the text, so every NPC of that race and gender saying it shares
 * one. Adding the NPC and the quest is not enough either - 141 quest lines in the corpus
 * share an NPC, a quest id, a source *and* an mp3 with another line whose text differs, and
 * those are indistinguishable by any field at all.
 *
 * Grouping by NPC used to hide all of this. A flat list cannot.
 *
 * Keyed off the corpus object rather than a module global so a test can hold two.
 */
export function rowKeys(corpus: Corpus): Map<CorpusLine, string> {
  let keys = keyCache.get(corpus);
  if (!keys) {
    keys = new Map(corpus.lines.map((line, index) => [line, `${line.lineId}#${index}`]));
    keyCache.set(corpus, keys);
  }
  return keys;
}

function matches(line: CorpusLine, q: string, filter: Filter): boolean {
  const needle = q.toLowerCase();
  const textHit = line.text.toLowerCase().includes(needle);
  if (filter === "text") return textHit;

  // A bare number is an id lookup, not a substring: this is what the CLI means by it, and
  // "240" finding every line that mentions 240 gold would bury the NPC you asked for.
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;
  if (asNumber !== null) {
    const npcHit = line.npcId === asNumber;
    const questHit = line.questId === asNumber;
    if (filter === "npc") return npcHit;
    if (filter === "quest") return questHit;
    return npcHit || questHit;
  }

  const npcHit = line.npcName.toLowerCase().includes(needle);
  const questHit = (line.questTitle ?? "").toLowerCase().includes(needle);
  if (filter === "npc") return npcHit;
  if (filter === "quest") return questHit;
  return npcHit || questHit || textHit;
}

/**
 * A gap: a line the generator would voice, with nothing in the store.
 *
 * Same definition as missing_lines (tts_cli/store.py) - lines the generator never voices
 * (progress text, unresolved template tokens) are expected absences, not gaps.
 */
export function isGap(
  line: CorpusLine,
  store: Set<string>,
  overrides: Map<string, LineOverride> = NO_CONTEXT.overrides,
): boolean {
  const audioPath = audioRelPath(line);
  const text = overrides.get(audioPath)?.text ?? line.text;
  return isVoiceable(line, text) && !store.has(audioPath);
}

/** Whether a line carries a finding the filter is asking for. */
function issueMatch(found: LineIssues | undefined, want: NonNullable<LineFilters["issues"]>): boolean {
  if (!found) return false;
  return want === "any" || found.severity <= want;
}

function categoryMatch(found: LineIssues | undefined, want: string): boolean {
  if (!found) return false;
  // A group ("name") or a category ("name-apostrophe"), so the review queue can link to one
  // finding's kind and the dropdown can offer the eight groups.
  return found.categories.some((c) => c === want || categoryGroup(c) === want);
}

/**
 * Display order.
 *
 * Deterministic first of all, because paging a list whose order can shift would drop and
 * repeat rows between pages. Within that, an NPC's lines stay adjacent and their quests stay
 * together, so the flat list still reads like a conversation rather than a shuffled index.
 * Gossip sorts after every quest, where the old gossip group also sat.
 */
function order(a: CorpusLine, b: CorpusLine): number {
  return (
    a.npcName.localeCompare(b.npcName) ||
    npcKey(a).localeCompare(npcKey(b)) ||
    // U+FFFF, so a null quest title (gossip) sorts after any real one.
    (a.questTitle ?? "￿").localeCompare(b.questTitle ?? "￿") ||
    a.lineId.localeCompare(b.lineId)
  );
}

/**
 * Every line the filters admit, unpaged and in display order.
 *
 * Exported because regenerating "everything matching" acts on the whole set, not the page
 * someone happens to be looking at.
 */
export function matchingLines(
  corpus: Corpus,
  store: Set<string>,
  {
    q = "",
    filter = "any",
    missingOnly = false,
    race,
    gender,
    flavor,
    voice,
    source,
    npcType,
    issues,
    issueCategory,
    overridden,
  }: LineFilters = {},
  { issues: found, overrides }: SearchContext = NO_CONTEXT,
): CorpusLine[] {
  const query = q.trim();

  let lines = corpus.lines;
  if (query) lines = lines.filter((line) => matches(line, query, filter));
  if (missingOnly) lines = lines.filter((line) => isGap(line, store, overrides));
  if (race) lines = lines.filter((line) => line.race === race);
  if (gender) lines = lines.filter((line) => line.gender === gender);
  if (flavor) lines = lines.filter((line) => line.flavor === flavor);
  if (voice) lines = lines.filter((line) => line.voice === voice);
  if (source) lines = lines.filter((line) => line.source === source);
  if (npcType) lines = lines.filter((line) => line.npcType === npcType);
  if (issues) lines = lines.filter((line) => issueMatch(found.get(line.lineId), issues));
  if (issueCategory) {
    lines = lines.filter((line) => categoryMatch(found.get(line.lineId), issueCategory));
  }
  if (overridden) lines = lines.filter((line) => overrides.has(audioRelPath(line)));

  return [...lines].sort(order);
}

export function search(
  corpus: Corpus,
  store: Set<string>,
  { offset = 0, limit = PAGE_SIZE, ...filters }: SearchOptions = {},
  context: SearchContext = NO_CONTEXT,
): SearchResult {
  const all = matchingLines(corpus, store, filters, context);
  const keys = rowKeys(corpus);

  const start = Math.max(0, Math.floor(offset));
  const lines = all.slice(start, start + limit).map((line) => {
    const audioPath = audioRelPath(line);
    const override = context.overrides.get(audioPath)?.text ?? null;
    return {
      ...line,
      key: keys.get(line)!,
      hasAudio: store.has(audioPath),
      audioPath,
      issue: context.issues.get(line.lineId) ?? null,
      override,
      voiceable: isVoiceable(line, override ?? line.text),
    };
  });

  return {
    lines,
    total: all.length,
    npcCount: new Set(all.map(npcKey)).size,
    offset: start,
    limit,
  };
}
