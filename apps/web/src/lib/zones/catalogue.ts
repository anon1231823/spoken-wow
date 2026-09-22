// The zones lore catalogue, built from `lore_line`.
//
// SERVER ONLY. The database is the corpus; addons/SpokenZones/Data/enUS/*.lua is an
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
import { loadDirtyContext, NO_DIRT, type DirtyContext } from "@/lib/generation/dirty";
import { BASE_LANG, type Lang } from "@/lib/lang";

import { corpusRows, currentLore } from "./lore";
import { liveTakes } from "@/lib/takes/store";
import {
  assignFiles,
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
  /**
   * What a language other than English has not written yet; the English stands in on the
   * page. A line whose text is missing has nothing to narrate, so `spoken` is empty and the
   * line cannot be queued. Absent in English, and where nothing is missing.
   */
  missing?: { text: boolean; name: boolean };
  /** The English prose, for a translator to work from. Absent when reading English. */
  english?: string;
  /** The English name of the place, likewise. */
  englishName?: string;
};

/**
 * A line as the explorer shows it.
 *
 * The same thing as a corpus line. The alias is kept because it is what every caller
 * names.
 */
export type CatalogueEntry = CorpusEntry;

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

/**
 * Everything database-backed, passed into the pure search rather than fetched by it.
 * This is the split ../wow-voiceover/web/src/lib/search.ts:82 makes, and the reason
 * the filtering logic is testable without a database.
 */
export type SearchContext = {
  takes: Map<string, Take>;
  /**
   * What the lexicon has changed lately, and what somebody has already judged fine.
   *
   * Carried rather than resolved into a set of ids, because the rule needs the line's text
   * as well as its take - and the text is the catalogue's, which this map is built beside.
   * See lib/generation/dirty.ts.
   */
  dirt: DirtyContext;
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
  dirt: NO_DIRT,
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
  constructor(lang: Lang = BASE_LANG) {
    super(
      lang === BASE_LANG
        ? "lore_line holds no English lines -- seed it with: make zones-lore-import " +
            "(and check DATABASE_URL points at the database you mean)"
        : `lore_line holds no ${lang} lines yet`,
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Whether a thrown thing is that, across the module boundary.
 *
 * `instanceof` rather than a name check would be enough in one process, and this is not
 * defensive dressing: `next dev` re-evaluates modules, so a route holding a reference to one
 * evaluation's class can be handed an error built by another's, and the two are not the same
 * constructor. The name is what survives.
 */
export function isCorpusEmpty(error: unknown): boolean {
  return error instanceof Error && error.name === "CorpusEmpty";
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
 */
type Memo<T> = { stamp: string; value: Promise<T> };

/** One memo per language, so a site switching between two does not rebuild on each request. */
const globalForCatalogue = globalThis as unknown as {
  zonesCatalogue?: Map<string, Memo<CatalogueEntry[]>>;
  zonesByPath?: Map<string, Memo<Map<string, CatalogueEntry>>>;
};

/** What one language's lore rows are, as one comparable value. See the note above. */
async function stampOf(lang: Lang = BASE_LANG): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select coalesce(max("id"), 0) || ':' || count(*) || ':'
             || coalesce(sum("id") filter (where "isCurrent"), 0) as "stamp"
       from "lore_line" where "lang" = $1`,
    [lang],
  );
  const own = rows[0]?.stamp ?? "0:0:0";
  if (lang === BASE_LANG) return own;

  // Another language is read over the English lines and names its places in entity_name,
  // so its memo moves with either of those as well as with its own prose.
  const names = await query<{ stamp: string }>(
    `select coalesce(max("id"), 0) || ':' || count(*) || ':'
             || coalesce(sum("id") filter (where "isCurrent"), 0) as "stamp"
       from "entity_name" where "lang" = $1 and "kind" in ('zone', 'subzone')`,
    [lang],
  );
  return `${await stampOf(BASE_LANG)}|${own}|${names[0]?.stamp ?? ""}`;
}

async function memoised<T>(
  slot: "zonesCatalogue" | "zonesByPath",
  lang: Lang,
  build: () => Promise<T>,
): Promise<T> {
  const stamp = await stampOf(lang);
  const memo = (globalForCatalogue[slot] ??= new Map()) as Map<string, Memo<T>>;

  const existing = memo.get(lang);
  if (existing && existing.stamp === stamp) return existing.value;

  const value = build();
  memo.set(lang, { stamp, value });
  return value;
}

/**
 * Every line, as a catalogue entry.
 *
 * The row supplies the structure and the prose; everything else is derived exactly as
 * tools/voice/generate.mjs derives it, so a line's id, audio path and hash are the same
 * whether the explorer or the CLI worked them out.
 */
async function buildCorpus(lang: Lang): Promise<CorpusEntry[]> {
  if (lang !== BASE_LANG) return buildTranslated(lang);
  const [rows, rules] = await Promise.all([corpusRows(lang), loadPronunciation()]);
  if (rows.length === 0) throw new CorpusEmpty(lang);

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

/**
 * Another language's lines: every English line, with this language's prose and place
 * names where it has them.
 *
 * The English lines are the skeleton, and not only because they are what exists: a line's
 * audio path is a slug of its English name (naming.mjs), frozen, and the same file in every
 * language. So the English is built exactly as it always is, and the language contributes
 * what it says and what it calls each place. Where it has not, the English stands in and
 * `missing` says so -- a rendering, never written back, and never voiced.
 *
 * Its spoken text goes through the English pronunciation rules for now, the only ones there
 * are; a language's own lexicon arrives with generating in it.
 */
async function buildTranslated(lang: Lang): Promise<CorpusEntry[]> {
  const [english, own, names, rules] = await Promise.all([
    catalogue(BASE_LANG),
    currentLore(lang),
    query<{ entityId: string; name: string }>(
      `select "entityId", "name" from "entity_name"
        where "lang" = $1 and "kind" in ('zone', 'subzone') and "isCurrent"`,
      [lang],
    ),
    loadPronunciation(),
  ]);
  const named = new Map(names.map((row) => [row.entityId, row.name]));

  return english.map((entry) => {
    const text = own.get(entry.id);
    const name = named.get(entry.id);
    const textMissing = !text || text.full.trim() === "";
    const spoken = textMissing ? "" : toSpokenText(text.full, rules);
    return {
      ...entry,
      name: name ?? entry.name,
      zoneName: named.get(`z:${entry.mapID}`) ?? entry.zoneName,
      full: text && !textMissing ? text.full : entry.full,
      short: text && !textMissing ? text.short : entry.short,
      source: text && !textMissing ? (text.source ?? undefined) : entry.source,
      spoken,
      hash: textHash(spoken),
      english: entry.full,
      englishName: entry.name,
      ...(textMissing || name === undefined
        ? { missing: { text: textMissing, name: name === undefined } }
        : {}),
    };
  });
}

export function catalogue(lang: Lang = BASE_LANG): Promise<CatalogueEntry[]> {
  return memoised("zonesCatalogue", lang, () => buildCorpus(lang));
}

/**
 * The corpus stamp, exposed so a writer can prove it moved.
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
  return memoised(
    "zonesByPath",
    lang,
    async () => new Map((await catalogue(lang)).map((entry) => [entry.file, entry])),
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
  const [takeRows, reportRows, dirt] = await Promise.all([
    liveTakes("zones", lang),
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
    loadDirtyContext("zones", lang),
  ]);

  return {
    takes: new Map(
      takeRows.map((row) => [
        row.lineId,
        {
          version: row.version,
          file: row.file,
          textHash: row.spokenHash ?? "",
          chars: row.characters ?? 0,
          credits: row.credits,
          durationSec: row.durationSec,
          bytes: row.bytes,
          modelId: row.modelId,
          voiceId: row.voiceId,
          generatedAt: row.createdAt.toISOString(),
          takes: row.takes,
        },
      ]),
    ),
    reports: new Map(reportRows.map((row) => [row.lineId, row.open])),
    dirt,
  };
}

/**
 * Whether a lineId names something that exists.
 *
 * `report` has no foreign key onto `lore_line`, so this is the only thing standing between
 * a typo and a row nothing will ever show or clean up. Every route that accepts a lineId
 * from outside calls it.
 */
export async function isKnownLine(lineId: string): Promise<boolean> {
  const entries = await catalogue();
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
