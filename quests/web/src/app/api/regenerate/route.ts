/**
 * Regenerate one line.
 *
 * One line per request, because the browser drives a batch: the loop, its progress and its
 * stop button live on the page, and the server stays stateless. That choice is what keeps
 * this endpoint free of a queue, a worker and everything needed to recover them after a
 * crash - at the cost that closing the tab ends a batch, leaving the lines already written
 * on disk and the rest untouched.
 *
 * The lineId travels in the body rather than the path. It contains colons (`q:5:accept`,
 * `g:{hash}:m`), and round-tripping those through a dynamic segment is encoding risk for no
 * benefit.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { regenerateLine } from "@/lib/generation/regenerate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { lineId?: unknown };
  if (typeof body.lineId !== "string" || !body.lineId) {
    return Response.json({ error: "lineId is required", kind: "bad-request" }, { status: 400 });
  }

  const result = await regenerateLine(body.lineId, session.user.id);

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
