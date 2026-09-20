/**
 * The Postgres-backed maps a quests search needs, fetched together and never fatally.
 *
 * The explorer reads the corpus and the audio store off disk on purpose: a database outage
 * takes accounts and regeneration with it, but browsing and playback keep working
 * (deploy/README.md). Overrides arrived after that promise was made and must not quietly
 * withdraw it - so a failure here degrades to an un-overridden search rather than a 500 on
 * the one page that was supposed to stay up.
 *
 * THAT PROMISE IS WEAKENING, DELIBERATELY. The corpus itself is moving into Postgres, where
 * the zones and books corpora already live, and a section whose words come from a table
 * cannot browse without it - those two answer an outage with a "corpus empty" page rather
 * than with stale prose. The fail-soft below is kept while the corpus is still a file, and
 * the day it is not, this function becomes the place to decide deliberately what an outage
 * looks like here. It should not simply rot into a catch that hides the new failure.
 *
 * The cost of being wrong is small and visible in the right direction: a rewritten line
 * reads as its corpus text. Nothing is generated from this - regenerate.ts reads the
 * override itself, and there a failure *should* be fatal.
 */
import { generatedAt } from "../generation/versions";
import { dirtyQuestFiles } from "./dirtiness";
import { staleFiles } from "./staleness";
import type { SearchContext } from "../search";
import { NO_CONTEXT } from "../search";
import { query } from "../db";
import { readIgnores } from "./ignores";
import { readOverrides } from "./overrides";

/**
 * lineId -> how many reports about it are still open.
 *
 * Grouped in the database rather than counted here, and `lineId is not null` excludes a
 * report about the project, which belongs to no line. The same query the zones and books
 * catalogues run; the count is public while the bodies are not, so a row can say "somebody
 * has already reported this one" without showing what they said.
 */
async function openReports(): Promise<Map<string, number>> {
  const rows = await query<{ lineId: string; open: number }>(
    `select "lineId", count(*)::int as "open"
       from "report"
      where "source" = 'quests' and "status" = 'open' and "lineId" is not null
      group by "lineId"`,
  );
  return new Map(rows.map((row) => [row.lineId, row.open]));
}

/**
 * @param dated whether a generation-date bound is in force. The dates are one query over the
 *   whole table, so they are fetched only for the searches that read them.
 * @param outdated whether the audio-outdated filter is in force. Same bargain: one query and a
 *   sha-256 per take, paid for only by the searches that ask.
 */
export async function searchContext(
  dated = false,
  outdated = false,
  dirty = false,
): Promise<SearchContext> {
  try {
    const [overrides, ignores, reports, dates, stale, dirt] = await Promise.all([
      readOverrides(),
      readIgnores(),
      openReports(),
      dated ? generatedAt() : null,
      outdated ? staleFiles() : null,
      dirty ? dirtyQuestFiles() : null,
    ]);
    return {
      overrides,
      ignores,
      reports,
      generatedAt: dates ?? undefined,
      stale: stale ?? undefined,
      dirty: dirt ?? undefined,
    };
  } catch (error) {
    console.warn("[quests] search context unavailable, serving unmarked results:", error);
    return NO_CONTEXT;
  }
}
