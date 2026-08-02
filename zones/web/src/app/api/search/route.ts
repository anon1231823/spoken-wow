import { NextResponse } from "next/server";

import { catalogue, loadContext } from "@/lib/catalogue";
import { filtersFromParams, PAGE_SIZE } from "@/lib/filters";
import { search } from "@/lib/search";

// The URL carries `page`, not `offset`, so a shared link survives a change to
// PAGE_SIZE. The arithmetic stays here.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersFromParams(params);
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [entries, context] = await Promise.all([catalogue(), loadContext()]);
  const result = search(entries, context, filters, (page - 1) * PAGE_SIZE, PAGE_SIZE);

  return NextResponse.json(result);
}
