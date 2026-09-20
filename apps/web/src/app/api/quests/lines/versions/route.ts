/**
 * What a page of search results needs to know about its files' takes, in one request.
 *
 * POST rather than GET because a search can name a few thousand files, and a query string
 * long enough to carry them would be refused by nginx before it arrived. Opening ONE line's
 * history is /api/takes, which every section shares; this stays quests-only because the two
 * questions it answers beside the counts -- staleness and pronunciation drift -- are
 * computed here from the corpus on disk, while zones and books answer both from their own
 * catalogues inside their search.
 */
import { corpusFiles } from "@/lib/audio";
import { requireRegenerate } from "@/lib/generation/authz";
import { dirtyQuestFiles } from "@/lib/quests/dirtiness";
import { staleFiles } from "@/lib/quests/staleness";
import { liveVersions, versionCounts } from "@/lib/generation/versions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { files?: unknown };
  if (!Array.isArray(body.files)) {
    return Response.json({ error: "files must be an array" }, { status: 400 });
  }

  const known = corpusFiles();
  const files = body.files.filter(
    (file): file is string => typeof file === "string" && known.has(file),
  );

  // All four in one round trip, because the page asks them about the same files: how many
  // takes are there, which one is live, is it still made of the current text, and was it
  // cut before a pronunciation it speaks was changed. The last is the one no hash can
  // answer.
  const [counts, live, stale, dirty] = await Promise.all([
    versionCounts(files),
    liveVersions(files),
    staleFiles(files),
    dirtyQuestFiles(files),
  ]);
  return Response.json({
    counts: Object.fromEntries(counts),
    live: Object.fromEntries(live),
    stale: [...stale],
    dirty: [...dirty],
  });
}
