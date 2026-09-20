/**
 * The two Postgres-backed maps a search needs, fetched together and never fatally.
 *
 * The explorer reads the corpus and the audio store off disk on purpose: a database outage
 * takes accounts and regeneration with it, but browsing and playback keep working
 * (deploy/README.md). Findings and overrides arrived after that promise was made, and they
 * must not quietly withdraw it - so a failure here degrades to an unmarked, un-overridden
 * search rather than a 500 on the one page that was supposed to stay up.
 *
 * The cost of being wrong is small and visible in the right direction: chips vanish, and a
 * rewritten line reads as its corpus text. Nothing is generated from this - regenerate.ts
 * reads the override itself, and there a failure *should* be fatal.
 */
import { generatedAt } from "../generation/versions";
import { dirtyQuestFiles } from "./dirtiness";
import { staleFiles } from "./staleness";
import type { SearchContext } from "../search";
import { NO_CONTEXT } from "../search";
import { readIgnores } from "./ignores";
import { readOverrides } from "./overrides";
import { findingLines, issuesByLine } from "./store";

/**
 * @param finding the finding whose lines were asked for, when one was. Fetched here so the
 *   route stays one call, and only when asked: it is a lookup nobody pays for by default.
 * @param dated whether a generation-date bound is in force. The dates are one query over the
 *   whole table, so they are fetched only for the searches that read them.
 * @param outdated whether the audio-outdated filter is in force. Same bargain: one query and a
 *   sha-256 per take, paid for only by the searches that ask.
 */
export async function searchContext(
  finding?: number,
  dated = false,
  outdated = false,
  dirty = false,
): Promise<SearchContext> {
  try {
    const [issues, overrides, ignores, lines, dates, stale, dirt] = await Promise.all([
      issuesByLine(),
      readOverrides(),
      readIgnores(),
      finding ? findingLines(finding) : null,
      dated ? generatedAt() : null,
      outdated ? staleFiles() : null,
      dirty ? dirtyQuestFiles() : null,
    ]);
    return {
      issues,
      overrides,
      ignores,
      findingLines: lines,
      generatedAt: dates ?? undefined,
      stale: stale ?? undefined,
      dirty: dirt ?? undefined,
    };
  } catch (error) {
    console.warn("[issues] search context unavailable, serving unmarked results:", error);
    return NO_CONTEXT;
  }
}
