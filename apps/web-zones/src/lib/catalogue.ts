// The lore catalogue, built from `lore_line`.
//
// SERVER ONLY. The database is the corpus; addon/ZoneLore/Data/<lang>/*.lua is an
// export of it (`make lore-export`, checked by `make lore-check`), so the app reads the
// table and never the files. Reading the Lua here would mean the explorer showed
// whatever was last exported and committed, and -- because a line only reaches the Lua
// through an export -- would let it list lines that cannot be saved, which is what it
// used to do.
//
// Pure helpers still come from tools/: naming, normalising and hashing are the same
// operations the CLI performs, and reimplementing them here is how the app and the
// generated audio start disagreeing.

import "server-only";

import {
  areaName,
  assignFiles,
  loadAreaNames,
  loadPronunciation,
  textHash,
  toSpokenText,
  type CatalogueEntry as CorpusEntry,
} from "./tools";
import { query } from "./db";
import { BASE_LANG, type Lang } from "./lang";
import { corpusRows, currentLore } from "./lore";

/**
 * A line as the explorer shows it, which is a corpus line plus what reading it in
 * another language adds.
 *
 * `english` is not the same thing as `source`: `source` is the wiki page the lore came
 * from and carries its licence, and a translation inherits it unchanged.
 */
export type CatalogueEntry = CorpusEntry & {
  /** The English prose this line is translated from. Absent when reading English. */
  english?: string;
  /** Whether this language has a row for the line at all. Absent when reading English. */
  translated?: boolean;
};

/** The live take for a line, as the explorer needs it. */
export type Take = {
  version: number;
  file: string;
  textHash: string;
  chars: number;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  modelId: string | null;
  voiceId: string | null;
  generatedAt: string;
  /** How many takes exist in total. 1 means there is nothing to go back to. */
  takes: number;
};

export type LineFlag = {
  status: "bad" | "ok";
  note: string | null;
  updatedAt: string;
};

/**
 * Everything database-backed, passed into the pure search rather than fetched by it.
 * This is the split ../wow-voiceover/web/src/lib/search.ts:82 makes, and the reason
 * the filtering logic is testable without a database.
 */
export type SearchContext = {
  takes: Map<string, Take>;
  flags: Map<string, LineFlag>;
  /**
   * lineId -> how many reports are still open. The COUNT only; the bodies are behind
   * requireFeedback() in api/feedback. A guest already sees the `bad` badge on a line for
   * the reason set out in LineRow -- "someone has already reported this one" is the answer
   * to the question a dissatisfied listener is about to ask -- and a count says no more
   * than that badge does.
   */
  feedback: Map<string, number>;
};

export const EMPTY_CONTEXT: SearchContext = {
  takes: new Map(),
  flags: new Map(),
  feedback: new Map(),
};

/**
 * The corpus is empty, so there is nothing to show.
 *
 * Distinguished from "no rows for this language", which is an untranslated language and
 * perfectly normal. This one means the English table itself is unseeded or unreachable,
 * and it is worth failing loudly on: the explorer used to fall back to the committed Lua
 * here, which rendered a full catalogue against a database that could not save a word of
 * it, and reported that only when somebody pressed save.
 */
export class CorpusEmpty extends Error {
  constructor() {
    super(
      "lore_line holds no English lines -- seed it with: make lore-import " +
        "(and check DATABASE_URL points at the database you mean)",
    );
    this.name = "CorpusEmpty";
  }
}

// Memoised on globalThis, for the reason db.ts caches its pool: `next dev` re-evaluates
// modules on every edit, and re-deriving 1353 entries -- a sha1 and a normalise pass per
// line -- on each one is a visible pause. The rows change on every text edit, which is
// why saving one calls invalidateCatalogue() rather than trusting the next request to
// notice. A write from outside this process (a scrape, `make lore-import`) is not seen
// until the server restarts.
// Keyed by language: this process serves every language, and a single memo would
// hand whichever was asked for first to everyone who asked afterwards.
const globalForCatalogue = globalThis as unknown as {
  /** The English corpus, derived once: every language's overlay starts from it. */
  zoneloreEnglish?: Promise<CorpusEntry[]>;
  zoneloreCatalogue?: Map<Lang, Promise<CatalogueEntry[]>>;
  zoneloreByPath?: Map<Lang, Promise<Map<string, CatalogueEntry>>>;
};

/**
 * Every English line, as a catalogue entry.
 *
 * The row supplies the structure and the prose; everything else is derived exactly as
 * tools/voice/generate.mjs derives it, so a line's id, audio path and hash are the same
 * whether the explorer or the CLI worked them out.
 */
async function buildEnglishCorpus(): Promise<CorpusEntry[]> {
  const [rows, rules] = await Promise.all([corpusRows(BASE_LANG), loadPronunciation()]);
  if (rows.length === 0) throw new CorpusEmpty();

  const files = assignFiles(rows);
  const zoneNames = new Map(
    rows.filter((row) => row.kind === "zone").map((row) => [row.mapID, row.name]),
  );

  return rows.map((row) => {
    const spoken = toSpokenText(row.full, rules);
    return {
      id: row.lineId,
      kind: row.kind,
      mapID: row.mapID,
      key: row.key,
      name: row.name,
      zoneName: zoneNames.get(row.mapID) ?? "",
      full: row.full,
      short: row.short,
      source: row.source ?? undefined,
      spoken,
      hash: textHash(spoken),
      file: files.get(row.lineId)!,
    };
  });
}

// The same input for all eleven languages, so it is derived once per process rather
// than once per language asked for.
function englishCorpus(): Promise<CorpusEntry[]> {
  if (!globalForCatalogue.zoneloreEnglish) {
    globalForCatalogue.zoneloreEnglish = buildEnglishCorpus();
  }
  return globalForCatalogue.zoneloreEnglish;
}

/**
 * The English corpus with one language's rows laid over the text.
 *
 * English is always the structural source. A translation never decides which lines
 * exist -- that is the scraper's business, and a language that could add or drop a line
 * would be a corpus rather than a translation.
 *
 * A translated line has its spoken text and hash recomputed, which is what makes the
 * staleness badge honest: rewriting the prose moves the hash away from the take's
 * textHash, and the line reads "text changed" exactly as it does after a pronunciation
 * rule is added.
 */
async function buildCatalogueFor(lang: Lang): Promise<CatalogueEntry[]> {
  const entries = await englishCorpus();
  if (lang === BASE_LANG) return entries;

  const [overrides, rules, names] = await Promise.all([
    currentLore(lang),
    loadPronunciation(),
    loadAreaNames(),
  ]);

  // Place names are the client's, not the translator's (tools/lib/area-names.mjs):
  // every row's name, and the zone name every row carries for the dropdown and the
  // Zone column, is what a client in this language shows on its map -- translated
  // line or not. English falls through where the client has no other name.
  const zoneNames = new Map<number, string>();
  for (const entry of entries) {
    if (entry.kind !== "zone") continue;
    zoneNames.set(entry.mapID, areaName(names, lang, entry, entry.name));
  }

  return entries.map((entry) => {
    const source = {
      ...entry,
      name: areaName(names, lang, entry, entry.name),
      zoneName: zoneNames.get(entry.mapID) ?? entry.zoneName,
    };

    const row = overrides.get(entry.id);
    if (!row) {
      if (lang === BASE_LANG) return source;

      // UNTRANSLATED LINES ARE EMPTY, not English.
      //
      // Falling back would make a language look further along than it is, and every
      // number derived from the text would describe English: the character count, the
      // regeneration quote, the "missing/stale/current" state. Worse, a batch would
      // happily narrate English prose with a German voice and record it as a German
      // take. Empty is the same answer the addon gives on a map with no lore -- a gap
      // you can see, rather than a plausible wrong one.
      //
      // The English survives as `english`, which the edit dialog shows as the source
      // text. That is the one place it is wanted.
      return {
        ...source,
        full: "",
        spoken: "",
        hash: textHash(""),
        english: source.full,
        translated: false,
      };
    }

    const spoken = toSpokenText(row.full, rules);
    return {
      ...source,
      full: row.full,
      spoken,
      hash: textHash(spoken),
      english: source.full,
      translated: true,
    };
  });
}

export function catalogue(lang: Lang = BASE_LANG): Promise<CatalogueEntry[]> {
  if (!globalForCatalogue.zoneloreCatalogue) {
    globalForCatalogue.zoneloreCatalogue = new Map();
  }
  const memo = globalForCatalogue.zoneloreCatalogue;
  if (!memo.has(lang)) {
    memo.set(lang, buildCatalogueFor(lang));
  }
  return memo.get(lang)!;
}

/**
 * Drops the memoised catalogue so the next read rebuilds it.
 *
 * Required after saving a lore edit, and after writing pronunciation.json: every entry's `spoken` and `hash` are
 * built from those rules at load time, and staleness is a comparison against `hash`.
 * Without this, saving a rule would report an impact the explorer then refused to
 * show -- the lines would stay "current" until the server was restarted, which is
 * exactly the sort of disagreement this app exists to remove.
 */
export function invalidateCatalogue(lang?: Lang): void {
  // A pronunciation change moves every language's spoken text, so it drops all of
  // them; a lore edit names its own. Dropping English also drops the translations,
  // which are built from it.
  if (lang === undefined || lang === BASE_LANG) {
    // The English corpus goes too: it holds the prose every translation is laid over,
    // and its own spoken text and hashes.
    globalForCatalogue.zoneloreEnglish = undefined;
    globalForCatalogue.zoneloreCatalogue = undefined;
    globalForCatalogue.zoneloreByPath = undefined;
    return;
  }
  globalForCatalogue.zoneloreCatalogue?.delete(lang);
  globalForCatalogue.zoneloreByPath?.delete(lang);
}

/**
 * A line, addressed by the path its audio file uses: '1411/razor-hill', '1411/zone'.
 *
 * This is what /r/{mapID}/{slug} resolves through. The addon builds that URL from the
 * two things it has -- the uiMapID and the canonical area key -- by reimplementing
 * naming.mjs's slugFor in Lua, so the mapping only has to hold in this direction:
 * given a path, which line owns it. Nothing here needs to know how it was spelled.
 *
 * Memoised like catalogue() and addressableFiles(), and for the same reason.
 */
function linesByPath(lang: Lang): Promise<Map<string, CatalogueEntry>> {
  if (!globalForCatalogue.zoneloreByPath) {
    globalForCatalogue.zoneloreByPath = new Map();
  }
  const memo = globalForCatalogue.zoneloreByPath;
  if (!memo.has(lang)) {
    memo.set(
      lang,
      catalogue(lang).then((entries) => new Map(entries.map((entry) => [entry.file, entry]))),
    );
  }
  return memo.get(lang)!;
}

export async function lineByPath(
  mapID: number,
  slug: string,
  lang: Lang = BASE_LANG,
): Promise<CatalogueEntry | undefined> {
  if (!Number.isInteger(mapID)) return undefined;
  return (await linesByPath(lang)).get(`${mapID}/${slug}`);
}

export async function loadContext(lang: Lang = BASE_LANG): Promise<SearchContext> {
  const [takeRows, flagRows, feedbackRows] = await Promise.all([
    query<{
      lineId: string;
      version: number;
      file: string;
      textHash: string;
      chars: number;
      credits: number | null;
      durationSec: number | null;
      bytes: number;
      modelId: string | null;
      voiceId: string | null;
      generatedAt: Date;
      takes: string;
    }>(
      // Scoped in both halves. A take is current per language (migration 0009), so an
      // unscoped read would collide two rows into one Map entry, and an unscoped count
      // would report every language's takes as this one's -- offering a restore of a
      // clip in a language nobody is looking at.
      `select t."lineId", t."version", t."file", t."textHash", t."chars", t."credits",
              t."durationSec", t."bytes", t."modelId", t."voiceId", t."generatedAt",
              (select count(*) from "voiceline_take" a
                where a."lineId" = t."lineId" and a."lang" = t."lang") as "takes"
         from "voiceline_take" t
        where t."isCurrent" and t."lang" = $1`,
      [lang],
    ),
    // A flag is a verdict on one language's text and audio (migration 0010), so the
    // English worklist and the German one are different lists.
    query<{ lineId: string; status: "bad" | "ok"; note: string | null; updatedAt: Date }>(
      `select "lineId", "status", "note", "updatedAt" from "line_flag" where "lang" = $1`,
      [lang],
    ),
    // Grouped in the database rather than counted here: the resolved rows are the ones
    // that accumulate, and there is no reason to carry them across the wire to drop them.
    // `lineId is not null` excludes feedback about the project, which belongs to no line.
    query<{ lineId: string; open: number }>(
      `select "lineId", count(*)::int as "open"
         from "feedback"
        where "status" = 'open' and "lineId" is not null and "lang" = $1
        group by "lineId"`,
      [lang],
    ),
  ]);

  return {
    takes: new Map(
      takeRows.map((row) => [
        row.lineId,
        {
          version: row.version,
          file: row.file,
          textHash: row.textHash,
          chars: row.chars,
          credits: row.credits,
          durationSec: row.durationSec,
          bytes: row.bytes,
          modelId: row.modelId,
          voiceId: row.voiceId,
          generatedAt: row.generatedAt.toISOString(),
          // count(*) is bigint; the int8 parser in db.ts turns it into a number, but
          // Number() here keeps this honest if that parser is ever removed.
          takes: Number(row.takes),
        },
      ]),
    ),
    flags: new Map(
      flagRows.map((row) => [
        row.lineId,
        { status: row.status, note: row.note, updatedAt: row.updatedAt.toISOString() },
      ]),
    ),
    feedback: new Map(feedbackRows.map((row) => [row.lineId, row.open])),
  };
}

/**
 * Whether a lineId names something that exists.
 *
 * Neither `line_flag` nor `feedback` has a foreign key onto `lore_line`, so this is the
 * only thing standing between a typo and a row nothing will ever show or clean up. Every
 * route that accepts a lineId from outside calls it.
 */
export async function isKnownLine(lineId: string, lang: Lang = BASE_LANG): Promise<boolean> {
  const entries = await catalogue(lang);
  return entries.some((entry) => entry.id === lineId);
}

/** The zone dropdown's options, derived from the catalogue rather than hardcoded. */
export type ZoneFacet = { mapID: number; name: string; lines: number };

export async function zoneFacets(lang: Lang = BASE_LANG): Promise<ZoneFacet[]> {
  const entries = await catalogue(lang);
  const counts = new Map<number, ZoneFacet>();

  for (const entry of entries) {
    const existing = counts.get(entry.mapID);
    if (existing) {
      existing.lines++;
    } else {
      counts.set(entry.mapID, { mapID: entry.mapID, name: entry.zoneName, lines: 1 });
    }
  }

  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}
