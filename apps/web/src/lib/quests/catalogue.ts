/**
 * The quest corpus as the explorer sees it: every line, with who speaks it.
 *
 * SERVER ONLY, and the counterpart of lib/zones/catalogue.ts and lib/books/catalogue.ts --
 * the third section finally reading its corpus from the same place as the other two. It
 * used to come from corpus/corpus.json.gz, memoised forever on the reasoning that "the
 * corpus ships inside the release and cannot change under a running process". That stopped
 * being true the moment a line could be edited here.
 *
 * The rows are joined back into exactly the shape the file had -- one row per (line ×
 * speaker) -- so lib/search.ts, lib/facets.ts and everything downstream are unchanged.
 * That is deliberate: the point of this change is where the words live, not what the
 * explorer does with them.
 *
 * MEMOISED AGAINST A STAMP THE TABLES THEMSELVES CARRY, copied from books
 * (lib/books/catalogue.ts): max id, count, and the sum of live ids. Three terms because
 * there are three ways the table moves -- an edit inserts a version so the highest id
 * moves, an import can delete so the count moves, and a restore moves the live flag
 * between rows that already exist, which only the sum of live ids notices. The speakers
 * count separately, being replaced wholesale on every import.
 *
 * pm2 runs two workers, so an in-process invalidation would be a memo one worker drops and
 * the other keeps serving. There is deliberately no invalidate() for that reason.
 */
import "server-only";

import { query } from "@/lib/db";
import type { Corpus, CorpusLine } from "@/lib/corpus";

export const BASE_LANG = "enUS";

/**
 * The corpus holds no lines at all, which is a different thing from a search matching none.
 *
 * Between a fresh database and the first import this is the normal state, and a page that
 * says "run the import" is a better answer than one that looks like the game has no quests
 * in it. Both other sections have had this; quests could not, because a missing file threw
 * somewhere further down.
 */
export class CorpusEmpty extends Error {
  constructor() {
    super(
      "quest_line holds no English lines -- seed it with: make quests-import-corpus " +
        "(and check DATABASE_URL points at the database you mean)",
    );
    this.name = "CorpusEmpty";
  }
}

/**
 * Whether a thrown thing is that, across the module boundary.
 *
 * `instanceof` would be enough in one process and this is not defensive dressing: `next
 * dev` re-evaluates modules, so a route holding one evaluation's class can be handed an
 * error built by another's, and the two are not the same constructor. The name survives.
 */
export function isCorpusEmpty(error: unknown): boolean {
  return error instanceof Error && error.name === "CorpusEmpty";
}

async function stampOf(lang: string): Promise<string> {
  const rows = await query<{ stamp: string }>(
    `select (select coalesce(max("id"), 0) || ':' || count(*) || ':'
                    || coalesce(sum("id") filter (where "isCurrent"), 0)
               from "quest_line" where "lang" = $1)
           || '/' ||
            (select coalesce(max("id"), 0) || ':' || count(*)
               from "quest_line_speaker" where "lang" = $1) as "stamp"`,
    [lang],
  );
  return rows[0]?.stamp ?? "0:0:0/0:0";
}

type Row = {
  lineId: string;
  source: string;
  questId: number | null;
  questTitle: string | null;
  npcId: number;
  npcName: string;
  npcType: string;
  race: string;
  gender: string;
  flavor: string | null;
  voice: string;
  playerGender: string | null;
  text: string;
  originalText: string;
  fileName: string;
  generatable: boolean;
  skipReason: string | null;
};

/**
 * One row per speaker, in the corpus's own order.
 *
 * `ord` is what makes that order reproducible: the corpus is a flat list and the export
 * has to give the addon build back the same list. Reading in the same order here means a
 * search result is ordered the way it always was, which paging depends on.
 */
async function build(lang: string): Promise<CorpusLine[]> {
  const rows = await query<Row>(
    `select l."lineId", l."source", l."questId", l."questTitle",
            s."npcId", s."npcName", s."npcType", s."race", s."gender", s."flavor", s."voice",
            l."playerGender", l."text", l."originalText", l."fileName",
            l."generatable", l."skipReason"
       from "quest_line_speaker" s
       join "quest_line" l
         on l."lineId" = s."lineId" and l."variant" = s."variant"
        and l."lang" = s."lang" and l."isCurrent"
      where s."lang" = $1
      order by s."ord"`,
    [lang],
  );

  if (rows.length === 0) throw new CorpusEmpty();

  return rows.map((row) => ({
    ...row,
    npcType: row.npcType as CorpusLine["npcType"],
    source: row.source as CorpusLine["source"],
    playerGender: row.playerGender as CorpusLine["playerGender"],
  }));
}

const cacheKey = Symbol.for("spoken.quests-catalogue");
type Holder = { [cacheKey]?: { stamp: string; lines: CorpusLine[] } };

/** Every line, rebuilt only when the tables have moved. */
export async function corpus(lang: string = BASE_LANG): Promise<Corpus> {
  const holder = globalThis as Holder;
  const stamp = await stampOf(lang);

  if (!holder[cacheKey] || holder[cacheKey].stamp !== stamp) {
    holder[cacheKey] = { stamp, lines: await build(lang) };
  }
  return { lines: holder[cacheKey].lines };
}

const indexKey = Symbol.for("spoken.quests-line-index");
type IndexHolder = { [indexKey]?: { lines: CorpusLine[]; index: Map<string, CorpusLine[]> } };

/**
 * lineId -> every row carrying it, which is not one row: a gossip line is a hash of its
 * text, so one id can name a dozen speakers, and 103 ids name two different lines.
 *
 * Tied to the identity of the array it was built from rather than to the stamp, so it
 * rebuilds exactly when the catalogue does and a test passing its own lines is never
 * answered from another's.
 */
export async function lineIndex(lang: string = BASE_LANG): Promise<Map<string, CorpusLine[]>> {
  const lines = (await corpus(lang)).lines;
  const holder = globalThis as IndexHolder;

  if (!holder[indexKey] || holder[indexKey].lines !== lines) {
    const index = new Map<string, CorpusLine[]>();
    for (const line of lines) {
      const group = index.get(line.lineId);
      if (group) group.push(line);
      else index.set(line.lineId, [line]);
    }
    holder[indexKey] = { lines, index };
  }
  return holder[indexKey].index;
}
