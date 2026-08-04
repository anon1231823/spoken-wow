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
  type CatalogueEntry,
} from "./tools";
import { query } from "./db";
import { currentLore } from "./lore";

export type { CatalogueEntry };

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
const globalForCatalogue = globalThis as unknown as {
  zoneloreCatalogue?: Promise<CatalogueEntry[]>;
  zoneloreByPath?: Promise<Map<string, CatalogueEntry>>;
};

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
async function buildOverlaidCatalogue(): Promise<CatalogueEntry[]> {
  const [entries, overrides, rules] = await Promise.all([
    buildCatalogue(),
    // An unseeded table is not an error: before `make lore-import` has ever run, this is
    // empty and the explorer shows exactly what the committed Lua says.
    currentLore(),
    loadPronunciation(),
  ]);

  if (overrides.size === 0) return entries;

  return entries.map((entry) => {
    const row = overrides.get(entry.id);
    if (!row || (row.full === entry.full && row.name === entry.name)) return entry;

    const spoken = toSpokenText(row.full, rules);
    return { ...entry, name: row.name, full: row.full, spoken, hash: textHash(spoken) };
  });
}

export function catalogue(): Promise<CatalogueEntry[]> {
  if (!globalForCatalogue.zoneloreCatalogue) {
    globalForCatalogue.zoneloreCatalogue = buildOverlaidCatalogue();
  }
  return globalForCatalogue.zoneloreCatalogue;
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
export function invalidateCatalogue(): void {
  globalForCatalogue.zoneloreCatalogue = undefined;
  globalForCatalogue.zoneloreByPath = undefined;
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
function linesByPath(): Promise<Map<string, CatalogueEntry>> {
  if (!globalForCatalogue.zoneloreByPath) {
    globalForCatalogue.zoneloreByPath = catalogue().then(
      (entries) => new Map(entries.map((entry) => [entry.file, entry])),
    );
  }
  return globalForCatalogue.zoneloreByPath;
}

export async function lineByPath(
  mapID: number,
  slug: string,
): Promise<CatalogueEntry | undefined> {
  if (!Number.isInteger(mapID)) return undefined;
  return (await linesByPath()).get(`${mapID}/${slug}`);
}

export async function loadContext(): Promise<SearchContext> {
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
      `select t."lineId", t."version", t."file", t."textHash", t."chars", t."credits",
              t."durationSec", t."bytes", t."modelId", t."voiceId", t."generatedAt",
              (select count(*) from "voiceline_take" a where a."lineId" = t."lineId") as "takes"
         from "voiceline_take" t
        where t."isCurrent"`,
    ),
    query<{ lineId: string; status: "bad" | "ok"; note: string | null; updatedAt: Date }>(
      `select "lineId", "status", "note", "updatedAt" from "line_flag"`,
    ),
    // Grouped in the database rather than counted here: the resolved rows are the ones
    // that accumulate, and there is no reason to carry them across the wire to drop them.
    // `lineId is not null` excludes feedback about the project, which belongs to no line.
    query<{ lineId: string; open: number }>(
      `select "lineId", count(*)::int as "open"
         from "feedback"
        where "status" = 'open' and "lineId" is not null
        group by "lineId"`,
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
export async function isKnownLine(lineId: string): Promise<boolean> {
  const entries = await catalogue();
  return entries.some((entry) => entry.id === lineId);
}

/** The zone dropdown's options, derived from the catalogue rather than hardcoded. */
export type ZoneFacet = { mapID: number; name: string; lines: number };

export async function zoneFacets(): Promise<ZoneFacet[]> {
  const entries = await catalogue();
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
