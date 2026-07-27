import { NextRequest, NextResponse } from "next/server";

import { storeIndex } from "@/lib/audio";
import { loadCorpus } from "@/lib/corpus";
import { DEFAULT_LIMIT, search, type Filter } from "@/lib/search";

const FILTERS: Filter[] = ["any", "npc", "quest"];

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const filter = params.get("filter") as Filter | null;

  const result = search(loadCorpus(), storeIndex(), {
    q: params.get("q") ?? "",
    filter: filter && FILTERS.includes(filter) ? filter : "any",
    missingOnly: params.get("missing") === "1",
    limit: Number(params.get("limit")) || DEFAULT_LIMIT,
  });

  return NextResponse.json(result);
}
