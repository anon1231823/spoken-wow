import { NextRequest, NextResponse } from "next/server";

import { voicedFiles } from "@/lib/generation/versions";
import { corpus } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { dirtyQuestFiles } from "@/lib/quests/dirtiness";
import { staleFiles } from "@/lib/quests/staleness";
import { filtersFromParams, needsDates, needsDirty, needsStale } from "@/lib/search-request";
import { PAGE_SIZE, search } from "@/lib/search";

export const dynamic = "force-dynamic";

/**
 * One page of quests lines, each carrying everything its row shows.
 *
 * Every row says whether its audio is stale and whether it is dirty, the way the zones and
 * books rows always have. Quests used to leave both out and have the explorer ask a second
 * route for them per page, holding the answers in state beside the rows -- a second source
 * for the same facts, which the explorer then had to reconcile after every regeneration.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Number(params.get("limit")) || PAGE_SIZE;
  // The page number is what the URL carries, so a link stays meaningful if the page size
  // ever changes; the offset is arithmetic and belongs on this side of it.
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));

  // Only the context depends on the filters; the corpus and the voiced set do not, so
  // they are fetched alongside rather than after.
  const [filters, lines, voiced] = await Promise.all([
    filtersFromParams(params),
    corpus(),
    voicedFiles(),
  ]);
  const context = await searchContext(needsDates(filters), needsStale(filters), needsDirty(filters));

  // "Clear all" needs every dirty file the filter matches, not a page of rows. The same
  // shape the zones search route answers for its own explorer.
  if (params.get("ids") === "1") {
    const all = search(lines, voiced, { ...filters, offset: 0, limit: Number.MAX_SAFE_INTEGER }, context);
    const files = [...new Set(all.lines.map((line) => line.audioPath))];
    return NextResponse.json({ dirtyFiles: [...(await dirtyQuestFiles(files))] });
  }

  const result = search(lines, voiced, { ...filters, offset: (page - 1) * limit, limit }, context);

  // For the page only, when no filter already computed the whole set: the two questions
  // cost a query each over the files asked about, and fifty is what a page holds.
  const files = [...new Set(result.lines.map((line) => line.audioPath))];
  const [stale, dirty] = await Promise.all([
    context.stale ?? staleFiles(files),
    context.dirty ?? dirtyQuestFiles(files),
  ]);
  for (const line of result.lines) {
    line.stale = stale.has(line.audioPath);
    line.dirty = dirty.has(line.audioPath);
  }

  return NextResponse.json(result);
}
