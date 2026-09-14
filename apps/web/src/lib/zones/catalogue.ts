// The zones lore catalogue, built from `lore_line`.
//
// SERVER ONLY. The database is the corpus; addons/SpokenZones/Data/<lang>/*.lua is an
// export of it (`make zones-lore-export`, checked by `make zones-lore-check`), so the app
// reads the table and never the files. Reading the Lua here would mean the explorer showed
// whatever was last exported and committed, and -- because a line only reaches the Lua
// through an export -- would let it list lines that cannot be saved.
//
// Pure helpers still come from the pipeline: naming, normalising and hashing are the same
// operations the CLI performs, and reimplementing them here is how the app and the
// generated audio start disagreeing.

import "server-only";

import { query } from "@/lib/db";

import { BASE_LANG, type Lang } from "./lang";
import { corpusRows, currentLore } from "./lore";
import {
  areaName,
  assignFiles,
  loadAreaNames,
  loadPronunciation,
  textHash,
  toSpokenText,
} from "./tools";

/** One voiceable entry: a zone, or a subzone of one. */
export type CorpusEntry = {
  /** 'z:1411' | 's:1411:razor hill'. naming.mjs owns the format. */
  id: string;
  kind: "zone" | "subzone";
  mapID: number;
  /** The canonical subzone key, or null for a zone line. */
  key: string | null;
  name: string;
  zoneName: string;
  /** The prose shown in-game. */
  full: string;
  /** The one-line summary shown in list views. */
  short: string;
  /** Where the lore came from, and so its licence. */
  source?: string;
  /** What is actually sent to ElevenLabs: brackets stripped, rules applied. */
  spoken: string;
  /** sha1 of `spoken`. Compared against a take's hash to detect staleness. */
  hash: string;
  /** Store-relative and extension-less, e.g. '1411/razor-hill'. */
  file: string;
};

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
   * lineId -> how many reports are still open. The COUNT only; the bodies are behind the
   * triage role on /reports. A visitor already sees the `bad` badge on a line -- "someone
   * has already reported this one" is the answer to the question a dissatisfied listener
   * is about to ask -- and a count says no more than that badge does.
   */
  reports: Map<string, number>;
};

export const EMPTY_CONTEXT: SearchContext = {
  takes: new Map(),
  flags: new Map(),
  reports: new Map(),
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
      "lore_line holds no English lines -- seed it with: make zones-lore-import " +
        "(and check DATABASE_URL points at the database you mean)",
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Memoised, and checked against the table rather than dropped by hand.
 *
 * Deriving 1353 entries is a sha1 and a normalise pass per line, so doing it per request
 * would be a visible pause; `next dev` re-evaluating modules on every edit is the other
 * reason this hangs off globalThis, the same one db.ts caches its pool for.
 *
 * THE ZONES SITE DROPPED THIS MEMO BY CALLING invalidateCatalogue() AFTER A SAVE, WHICH
 * ONLY WORKED BECAUSE IT RAN ONE WORKER. Its pm2 config pinned `instances: 1` for the
 * batches it kept in process memory, and this inherited the assumption: an edit saved by
 * worker A left worker B serving the text from before it, for as long as B lived. This
 * app runs two workers and reloads them one at a time, so the memo is validated instead of
 * invalidated -- one cheap query per read, against a stamp every writer moves whether it
 * shares this process or not.
 *
 * The stamp answers "which rows are current", not merely "how many are there", because the
 * three ways this table changes are all different. An edit inserts a version, so the
 * highest id moves. An import or a hand-run scrape can delete, so the count moves. A
 * restore does neither -- it moves the live flag between rows that already exist -- so the
 * sum of the current ids is the third term, and it is the one that catches it. Getting this
 * wrong is not a slow rebuild, it is one worker serving the text a restore replaced for as
 * long as that worker lives.
 *
 * Not covered: pronunciation.json. Every entry's spoken text and hash are built from those
 * rules, and they are a file in the release rather than a row, so they change on a deploy
 * and a deploy restarts the process.
 *
 * Keyed by language, because this process serves every language and a single memo would
 * hand whichever was asked for first to everyone who asked afterwards.
 */
type Memo<T> = { stamp: string; value: Promise<T> };

const globalForCatalogue = globalThis as unknown as {
  /** The English corpus, derived once: every language's overlay starts from it. */
  zonesEnglish?: Memo<CorpusEntry[]>;
  zonesCatalogue?: Map<Lang, Memo<CatalogueEntry[]>>;
  zonesByPath?: Map<Lang, Memo<Map<string, CatalogueEntry>>>;
};

/** What the language's rows are, as one comparable value. See the note above. */
async function stampOf(lang: Lang): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select coalesce(max("id"), 0) || ':' || count(*) || ':'
             || coalesce(sum("id") filter (where "isCurrent"), 0) as "stamp"
       from "lore_line" where "lang" = $1`,
    [lang],
  );
  return rows[0]?.stamp ?? "0:0:0";
}

async function memoised<T>(
  slot: Map<Lang, Memo<T>>,
  lang: Lang,
  build: () => Promise<T>,
): Promise<T> {
  const stamp = await stampOf(lang);

  const existing = slot.get(lang);
  if (existing && existing.stamp === stamp) return existing.value;

  const value = build();
  slot.set(lang, { stamp, value });
  return value;
}

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

// The same input for every language, so it is derived once per process rather than once
// per language asked for.
async function englishCorpus(): Promise<CorpusEntry[]> {
  const stamp = await stampOf(BASE_LANG);
  const existing = globalForCatalogue.zonesEnglish;
  if (existing && existing.stamp === stamp) return existing.value;

  const value = buildEnglishCorpus();
  globalForCatalogue.zonesEnglish = { stamp, value };
  return value;
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
  if (!globalForCatalogue.zonesCatalogue) globalForCatalogue.zonesCatalogue = new Map();
  return memoised(globalForCatalogue.zonesCatalogue, lang, () => buildCatalogueFor(lang));
}

/**
 * The stamp for a language, exposed so a writer can prove it moved.
 *
 * There is deliberately no invalidate function. The zones site had one, called after every
 * save, and it was correct only because its pm2 config ran a single worker: an edit saved
 * by worker A left worker B serving the previous text for as long as B lived. A hook like
 * that cannot be made correct by calling it more carefully, so what replaced it is a
 * question every worker asks the database rather than an answer one worker tells itself.
 */
export { stampOf as catalogueStamp };

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
  if (!globalForCatalogue.zonesByPath) globalForCatalogue.zonesByPath = new Map();
  return memoised(globalForCatalogue.zonesByPath, lang, async () =>
    new Map((await catalogue(lang)).map((entry) => [entry.file, entry])),
  );
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
  const [takeRows, flagRows, reportRows] = await Promise.all([
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
      // Scoped in three ways, and each one matters. By source, because the take table
      // holds both sections and the two name files by their own frozen rules. By
      // language, because a take is current per language -- an unscoped read would
      // collide two rows into one Map entry. And the count by both, or it would report
      // every language's takes as this one's, offering a restore of a clip in a language
      // nobody is looking at.
      //
      // The column names are the merged table's; the manifest's spelling of them lives in
      // store.mjs, which is the seam the CLI shares. See migration 0020.
      `select t."lineId", t."version", t."file", t."spokenHash" as "textHash",
              t."characters" as "chars", t."credits", t."durationSec", t."bytes",
              t."modelId", t."voiceId", t."createdAt" as "generatedAt",
              (select count(*) from "take" a
                where a."source" = 'zones' and a."lineId" = t."lineId"
                  and a."lang" = t."lang") as "takes"
         from "take" t
        where t."source" = 'zones' and t."isCurrent" and t."lang" = $1`,
      [lang],
    ),
    // A flag is a verdict on one language's text and audio, so the English worklist and
    // the German one are different lists. No source column: line_flag is a zones table,
    // and a lineId in it is always 'z:' or 's:'. See migration 0023.
    query<{ lineId: string; status: "bad" | "ok"; note: string | null; updatedAt: Date }>(
      `select "lineId", "status", "note", "updatedAt" from "line_flag" where "lang" = $1`,
      [lang],
    ),
    // Grouped in the database rather than counted here: the resolved rows are the ones
    // that accumulate, and there is no reason to carry them across the wire to drop them.
    // `lineId is not null` excludes a report about the project, which belongs to no line.
    query<{ lineId: string; open: number }>(
      `select "lineId", count(*)::int as "open"
         from "report"
        where "source" = 'zones' and "status" = 'open' and "lineId" is not null
          and "lang" = $1
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
    reports: new Map(reportRows.map((row) => [row.lineId, row.open])),
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
