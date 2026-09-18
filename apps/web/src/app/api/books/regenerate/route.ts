/**
 * Regenerate one book page, synchronously.
 *
 * One click, one request, one answer, matching both other sections. Anything larger goes
 * through the shared queue in /api/regenerate/queue; this stays direct because a single
 * page is cheap, is reversible through the archive, and deserves its result immediately
 * rather than after a round trip and a poll.
 *
 * The lineId travels in the body rather than the path because it contains a colon
 * ('b:1381'), and round-tripping that through a dynamic segment is encoding risk for no
 * benefit.
 *
 * NOTHING IS PUBLISHED AFTERWARDS, unlike the zones route. The books addon and the Lua
 * lookup it would resolve clips through do not exist yet; when they do, the export belongs
 * here and in the worker's afterDrain, together.
 */
import { regenerateBookLine } from "@/lib/books/regenerate";
import { requireApiKey, requireRegenerate } from "@/lib/generation/authz";

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

  const result = await regenerateBookLine(body.lineId, session.user.id, { apiKey: key });

  if (!result.ok) {
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}
