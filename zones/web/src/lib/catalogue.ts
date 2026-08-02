// The lore catalogue, and the database state that decorates it.
//
// SERVER ONLY -- reads the filesystem through tools/voice/*.mjs. Client components
// import types from here and nothing else; the runtime split lives in filters.ts.

import "server-only";

import { buildCatalogue, type CatalogueEntry } from "./tools";
import { query } from "./db";

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
// The catalogue is derived from committed files that do not change while the server
// runs -- regenerating the lore data means restarting it, which is already true of
// every other constant here.
const globalForCatalogue = globalThis as unknown as {
  zoneloreCatalogue?: Promise<CatalogueEntry[]>;
};

export function catalogue(): Promise<CatalogueEntry[]> {
  if (!globalForCatalogue.zoneloreCatalogue) {
    globalForCatalogue.zoneloreCatalogue = buildCatalogue();
  }
  return globalForCatalogue.zoneloreCatalogue;
}

/**
 * Drops the memoised catalogue so the next read rebuilds it.
 *
 * Required after writing pronunciation.json: every entry's `spoken` and `hash` are
 * built from those rules at load time, and staleness is a comparison against `hash`.
 * Without this, saving a rule would report an impact the explorer then refused to
 * show -- the lines would stay "current" until the server was restarted, which is
 * exactly the sort of disagreement this app exists to remove.
 */
export function invalidateCatalogue(): void {
  globalForCatalogue.zoneloreCatalogue = undefined;
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
