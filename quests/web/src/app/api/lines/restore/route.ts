/**
 * Put an earlier take back into the store.
 *
 * The counterpart to regeneration, and the reason regeneration is safe to offer at all: a
 * re-roll is not always an improvement, and without this the only way back would be a file
 * copy on the droplet.
 *
 * Holds the same lock a regeneration does. Restoring while a regeneration of the same file
 * is in flight would have the two racing to decide what is current, and the loser's audio
 * would sit in the store under the winner's version number.
 */
import { corpusFiles } from "@/lib/audio";
import { requireRegenerate } from "@/lib/generation/authz";
import { restoreVersion } from "@/lib/generation/history";
import { BUSY, withFileLock } from "@/lib/generation/lock";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { file?: unknown; version?: unknown };

  if (typeof body.file !== "string" || !corpusFiles().has(body.file)) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 0) {
    return Response.json({ error: "version must be a whole number" }, { status: 400 });
  }

  const file = body.file;
  const version = body.version;

  const outcome = await withFileLock(file, async () => {
    try {
      return { ok: true as const, ...(await restoreVersion(file, version)) };
    } catch (error) {
      // restoreVersion refuses a version that was never recorded, and one whose audio has
      // since gone. Both are the caller asking for something that does not exist, and both
      // leave the store untouched.
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });

  if (outcome === BUSY) {
    return Response.json(
      { error: `${file} is being regenerated; try again in a moment` },
      { status: 409 },
    );
  }
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: 404 });
  }

  return Response.json({ file, ...outcome });
}
