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
import type { SearchContext } from "../search";
import { NO_CONTEXT } from "../search";
import { readOverrides } from "./overrides";
import { issuesByLine } from "./store";

export async function searchContext(): Promise<SearchContext> {
  try {
    const [issues, overrides] = await Promise.all([issuesByLine(), readOverrides()]);
    return { issues, overrides };
  } catch (error) {
    console.warn("[issues] search context unavailable, serving unmarked results:", error);
    return NO_CONTEXT;
  }
}
