/**
 * Every line a set of filters matches, as batch jobs.
 *
 * Separate from /api/search because the two answer different questions: that one answers
 * "what is on this page", this one answers "what would regenerating all of this do". Paging
 * the second would be meaningless - a cost estimate for 50 of 3,000 lines is worse than no
 * estimate at all.
 */
import { NextRequest, NextResponse } from "next/server";

import { corpus } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { filtersFromParams, needsStale } from "@/lib/search-request";
import { batchJobs, matchingLines } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const filters = await filtersFromParams(request.nextUrl.searchParams);
  const [catalogue, { voiced, context }] = await Promise.all([
    corpus(),
    searchContext(needsStale(filters)),
  ]);
  const lines = matchingLines(catalogue, voiced, filters, context);
  // The same overrides the estimate is built from, so the quote prices the text that will
  // actually be sent rather than the text the corpus happens to hold.
  return NextResponse.json({ jobs: batchJobs(lines, context.overrides) });
}
