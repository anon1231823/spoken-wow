/**
 * Regenerate one line, synchronously.
 *
 * One click, one request, one answer. Mass regeneration goes through the queue in
 * /api/regenerate/queue instead; this endpoint stays direct because a single line is cheap,
 * is reversible through history, and deserves its result immediately rather than after a
 * round trip and a poll.
 *
 * The concurrency budget in lib/generation/concurrency.ts reserves a slot for exactly this,
 * so a click still lands while a batch is running.
 *
 * The lineId travels in the body rather than the path. It contains colons (`q:5:accept`,
 * `g:{hash}:m`), and round-tripping those through a dynamic segment is encoding risk for no
 * benefit.
 */
import { requireApiKey, requireGenerationLang, requireRegenerate } from "@/lib/generation/authz";
import { regenerateLine } from "@/lib/generation/regenerate";

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

  const result = await regenerateLine(body.lineId, session.user.id, { apiKey: key });

  if (!result.ok) {
    // `fatal` is the whole contract with the browser: it says whether to abandon the rest of
    // the batch or move to the next line. Running out of credits fails every remaining line
    // identically, and discovering that ninety more times is what this prevents.
    return Response.json(
      { error: result.failure.message, kind: result.failure.kind, fatal: result.failure.fatal },
      { status: result.failure.status },
    );
  }

  return Response.json(result);
}
