/**
 * Every take of a line, and how many each line has.
 *
 * Two shapes, because the page needs two different things. Opening one line's history wants
 * the whole record; drawing a search result wants only "does this line have any", for up to
 * a few thousand files at once - and a query string long enough to name them all would be
 * refused by nginx before it arrived. Hence GET for one and POST for many.
 */
import { corpusFiles } from "@/lib/audio";
import { requireRegenerate } from "@/lib/generation/authz";
import { historyOf } from "@/lib/generation/history";
import { dirtyQuestFiles } from "@/lib/quests/dirtiness";
import { staleFiles } from "@/lib/quests/staleness";
import { versionCounts } from "@/lib/generation/versions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const file = new URL(request.url).searchParams.get("file");
  // Membership of the corpus, not a pattern: the same whitelist that makes the history
  // playback route traversal-proof.
  if (!file || !corpusFiles().has(file)) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }

  return Response.json({ file, versions: await historyOf(file) });
}

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

  // All three in one round trip, because the page asks them about the same files: how many
  // takes are there, is the live one still made of the current text, and was it cut before
  // a pronunciation it speaks was changed. The third is the one no hash can answer.
  const [counts, stale, dirty] = await Promise.all([
    versionCounts(files),
    staleFiles(files),
    dirtyQuestFiles(files),
  ]);
  return Response.json({
    counts: Object.fromEntries(counts),
    stale: [...stale],
    dirty: [...dirty],
  });
}
