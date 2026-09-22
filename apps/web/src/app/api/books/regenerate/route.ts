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
 * Nothing is published afterwards. The pack's Data/Sounds.lua is built from the take table
 * when the pack is packaged, against a database synced from production, so the site has no
 * addon artifact to keep up to date.
 */
import { regenerateBookLine } from "@/lib/books/regenerate";
import { requireApiKey, requireGenerationLang, requireRegenerate } from "@/lib/generation/authz";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;
  const { denied: badLang } = await requireGenerationLang(request);
  if (badLang) return badLang;

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
