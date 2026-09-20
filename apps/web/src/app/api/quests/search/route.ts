import { NextRequest, NextResponse } from "next/server";

import { voicedFiles } from "@/lib/generation/versions";
import { corpus } from "@/lib/quests/catalogue";
import { searchContext } from "@/lib/quests/context";
import { filtersFromParams, needsDates, needsDirty, needsStale } from "@/lib/search-request";
import { PAGE_SIZE, search } from "@/lib/search";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const limit = Number(params.get("limit")) || PAGE_SIZE;
  // The page number is what the URL carries, so a link stays meaningful if the page size
  // ever changes; the offset is arithmetic and belongs on this side of it.
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));

  const filters = await filtersFromParams(params);
  const result = search(
    await corpus(),
    await voicedFiles(),
    { ...filters, offset: (page - 1) * limit, limit },
    await searchContext(
      needsDates(filters),
      needsStale(filters),
      needsDirty(filters),
    ),
  );

  return NextResponse.json(result);
}
