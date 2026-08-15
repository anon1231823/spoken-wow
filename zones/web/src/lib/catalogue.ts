// The lore catalogue, and the database state that decorates it.
//
// SERVER ONLY -- reads the filesystem through tools/voice/*.mjs. Client components
// import types from here and nothing else; the runtime split lives in filters.ts.

import "server-only";

import {
  buildCatalogue,
  loadPronunciation,
  textHash,
  toSpokenText,
  type CatalogueEntry as CorpusEntry,
} from "./tools";
import { query } from "./db";
import { BASE_LANG, type Lang } from "./lang";
import { currentLore } from "./lore";

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

// Memoised on globalThis, for the reason db.ts caches its pool: `next dev`
// re-evaluates modules on every edit, and re-reading and re-normalising 1353 lore
// entries (a megabyte of Lua, plus a sha1 per line) on each one is a visible pause.
// The Lua half is derived from committed files that do not change while the server runs.
// The lore_line half does change, on every text edit -- which is why saving one calls
// invalidateCatalogue() rather than trusting the next request to notice.
// Keyed by language: this process serves every language, and a single memo would
// hand whichever was asked for first to everyone who asked afterwards.
const globalForCatalogue = globalThis as unknown as {
  /** The English Lua, parsed once: every language's overlay starts from it. */
  zoneloreLua?: Promise<CorpusEntry[]>;
  zoneloreCatalogue?: Map<Lang, Promise<CatalogueEntry[]>>;
  zoneloreByPath?: Map<Lang, Promise<Map<string, CatalogueEntry>>>;
};

// A megabyte of Lua and a sha1 per line, and the same input for all eleven
// languages -- so it is read once per process, not once per language asked for.
function englishLua(): Promise<CorpusEntry[]> {
  if (!globalForCatalogue.zoneloreLua) {
    globalForCatalogue.zoneloreLua = buildCatalogue(BASE_LANG);
  }
  return globalForCatalogue.zoneloreLua;
}

/**
 * The catalogue as the Lua files have it, with the live rows of `lore_line` laid over
 * the top.
 *
 * Two sources rather than one because they answer different questions. The Lua is what
 * the addon currently ships and what a clone with no database can still build from; the
 * table is what the corpus has been edited to since. Layering keeps `tools/` free of a
 * database -- buildCatalogue() is the same function the CLI runs -- while making an edit
 * visible in the explorer immediately, instead of after an export, a commit and a deploy.
 *
 * An overlaid line has its spoken text and hash recomputed, which is what makes the
 * staleness badge honest: rewriting the prose moves the hash away from the take's
 * textHash, and the line reads "text changed" exactly as it does after a pronunciation
 * rule is added.
 */
async function buildOverlaidCatalogue(lang: Lang): Promise<CatalogueEntry[]> {
  // English is always the structural source. A translation has no Lua files of its own
  // until it is exported, and it never decides which lines exist -- that is the
  // scraper's business, and a language that could add or drop a line would be a corpus
  // rather than a translation. So the English catalogue supplies the shape, and the
  // translated rows are laid over the text.
  const [entries, translatedFrom, overrides, rules] = await Promise.all([
    englishLua(),
    lang === BASE_LANG ? Promise.resolve(null) : currentLore(BASE_LANG),
    currentLore(lang),
    loadPronunciation(),
  ]);

  // English edits show through under a translation too: they are what the translator is
  // translating from, and showing the older scraped text would have them working from a
  // line nobody ships any more.
  const english = translatedFrom ?? overrides;

  // English with no edits at all is the committed Lua exactly; every other language has
  // work to do per line even when nothing is translated yet.
  if (lang === BASE_LANG && overrides.size === 0) return entries;

  // A zone's name comes from its own line ("z:{mapID}"), and every line in the zone
  // carries it as zoneName -- the dropdown, the Zone column and the report page's
  // heading all read that. So a translated zone line renames the zone for its
  // subzones too. A zone whose line is not translated keeps the English name: it is a
  // label, not lore, and a blank label would make the list unreadable rather than
  // honest.
  const zoneNames = new Map<number, string>();
  for (const entry of entries) {
    if (entry.kind !== "zone") continue;
    const row = overrides.get(entry.id) ?? english.get(entry.id);
    if (row) zoneNames.set(entry.mapID, row.name);
  }

  return entries.map((entry) => {
    const englishRow = english.get(entry.id);
    const source = {
      ...entry,
      ...(englishRow ? { name: englishRow.name, full: englishRow.full } : {}),
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
      name: row.name,
      full: row.full,
      spoken,
      hash: textHash(spoken),
      ...(lang === BASE_LANG ? {} : { english: source.full, translated: true }),
    };
  });
}

export function catalogue(lang: Lang = BASE_LANG): Promise<CatalogueEntry[]> {
  if (!globalForCatalogue.zoneloreCatalogue) {
    globalForCatalogue.zoneloreCatalogue = new Map();
  }
  const memo = globalForCatalogue.zoneloreCatalogue;
  if (!memo.has(lang)) {
    memo.set(lang, buildOverlaidCatalogue(lang));
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
    // The Lua goes too. It only changes with a lore export, but a full drop is the
    // moment to notice one, and it is one parse.
    globalForCatalogue.zoneloreLua = undefined;
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
 * Neither `line_flag` nor `feedback` has a foreign key -- a line is derived from committed
 * Lua, not a row -- so this is the only thing standing between a typo and a row nothing
 * will ever show or clean up. Every route that accepts a lineId from outside calls it.
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
