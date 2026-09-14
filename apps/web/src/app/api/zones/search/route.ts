/**
 * The zones explorer's only read.
 *
 * The URL carries `page`, not `offset`, so a shared link survives a change to PAGE_SIZE.
 * The arithmetic stays here.
 */
import { catalogue, loadContext } from "@/lib/zones/catalogue";
import { filtersFromParams, PAGE_SIZE } from "@/lib/zones/filters";
import { BASE_LANG } from "@/lib/zones/lang";
import { search } from "@/lib/zones/search";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = filtersFromParams(params);
  // English, until the site has a language selector again. The library below takes a
  // language throughout; this is the edge that decides which one. See lib/zones/lang.ts.
  const lang = BASE_LANG;
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [entries, context] = await Promise.all([catalogue(lang), loadContext(lang)]);

  // "Regenerate everything this filter matches" needs every matching id, not a page of
  // rows. Ids only: the corpus is ~1,400 lines and the queue re-derives the rest from them.
  if (params.get("ids") === "1") {
    const all = search(entries, context, filters, 0, Number.MAX_SAFE_INTEGER);
    return Response.json({
      ids: all.lines.map((line) => line.id),
      total: all.total,
      // Summed here rather than in the browser: the confirmation dialog needs the character
      // total to quote a cost, and this query has already counted it.
      totalChars: all.totalChars,
    });
  }

  return Response.json(search(entries, context, filters, (page - 1) * PAGE_SIZE, PAGE_SIZE));
}
