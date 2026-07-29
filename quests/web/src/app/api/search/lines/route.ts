/**
 * Every line a set of filters matches, as batch jobs.
 *
 * Separate from /api/search because the two answer different questions: that one answers
 * "what is on this page", this one answers "what would regenerating all of this do". Paging
 * the second would be meaningless - a cost estimate for 50 of 3,000 lines is worse than no
 * estimate at all.
 */
import { NextRequest, NextResponse } from "next/server";

import { storeIndex } from "@/lib/audio";
import { loadCorpus } from "@/lib/corpus";
import { filtersFromParams } from "@/lib/search-request";
import { batchJobs, matchingLines } from "@/lib/search";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const lines = matchingLines(loadCorpus(), storeIndex(), filtersFromParams(request.nextUrl.searchParams));
  return NextResponse.json({ jobs: batchJobs(lines) });
}
