/**
 * Put an earlier take back, in whichever section owns the file.
 *
 * The counterpart of regeneration, and the reason regeneration is safe to offer at all: a
 * re-roll is not always an improvement, and without this the only way back would be a file
 * copy on the droplet.
 *
 * RESTORING MOVES THE LIVE FLAG. It writes no new take and copies no bytes to a new number,
 * because every take is archived under its own version as it is cut: the history is the set
 * of takes this line has had, and restoring says which of them is right rather than making
 * another one. It is the same thing `restore` means for a lore version (lib/zones/lore.ts).
 *
 * Holds the same lock a regeneration does. Restoring while a regeneration of the same file
 * is in flight would have the two racing to decide what is current, and the loser's audio
 * would sit in the store under the winner's version number.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { BUSY, withTakeLock } from "@/lib/generation/lock";

import { isAddressableFile } from "@/lib/takes/files";
import { restoreTake } from "@/lib/takes/restore";
import { isSource } from "@/lib/sections";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    source?: unknown;
    file?: unknown;
    version?: unknown;
  };

  if (!isSource(body.source)) {
    return Response.json({ error: "source must be quests, zones or books" }, { status: 400 });
  }
  const source = body.source;

  if (typeof body.file !== "string" || !(await isAddressableFile(source, body.file))) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version) || body.version < 1) {
    return Response.json({ error: "version must be a whole number" }, { status: 400 });
  }

  const file = body.file;
  const version = body.version;

  const outcome = await withTakeLock(source, file, async () => {
    try {
      await restoreTake(source, file, version);
      return { ok: true as const };
    } catch (error) {
      // restoreTake refuses a version that was never recorded, and one whose bytes cannot
      // be found for certain. Both are the caller asking for something that does not
      // exist, and both leave the store untouched.
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

  return Response.json({ source, file, version });
}
