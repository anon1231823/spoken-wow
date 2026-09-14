/**
 * Regenerate one zone line, synchronously.
 *
 * One click, one request, one answer, matching the quests side. Anything larger goes
 * through the shared queue in /api/regenerate/queue; this stays direct because a single
 * line is cheap, is reversible through the archive, and deserves its result immediately
 * rather than after a round trip and a poll.
 *
 * The lineId travels in the body rather than the path for the reason the quests one does:
 * it contains colons ('s:1411:razor hill'), and round-tripping those through a dynamic
 * segment is encoding risk for no benefit.
 */
import { requireApiKey, requireRegenerate } from "@/lib/generation/authz";
import { publish, regenerateZoneLine } from "@/lib/zones/regenerate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  // After the role check, never instead of it: a key is a credential, not a permission.
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  const result = await regenerateZoneLine(body.lineId, session.user.id, { apiKey: key });

  if (!result.ok) {
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  // The addon resolves every clip through Sounds.lua, so a take that is not in it is
  // unreachable. A batch publishes once when the queue drains; a single line has no drain
  // to wait for, and leaving it unpublished until the next batch would make one-off
  // regeneration the one path whose result the addon cannot play.
  await publish().catch((error: unknown) => {
    console.error("zones: could not rebuild the lookup after a single regeneration", error);
  });

  return Response.json(result);
}
