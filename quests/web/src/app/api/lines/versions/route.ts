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

  return Response.json({ counts: Object.fromEntries(await versionCounts(files)) });
}
