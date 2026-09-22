/**
 * Changing a contribution's status.
 *
 * A sibling route, not a second verb on /api/contributions: that path's POST is open to the
 * whole internet and this one must never be. Collaborator rather than admin, as on the reports
 * side -- these are the people who already act on lines.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { isStatus } from "@/lib/contributions/contributions";
import { resolveContribution } from "@/lib/contributions/accept";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown contribution" }, { status: 404 });
  }
  if (!isStatus(body.status)) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  const outcome = await resolveContribution(id, body.status, session.user.id);
  if (!outcome.ok) {
    if (outcome.reason === "not-found") {
      return Response.json({ error: "unknown contribution" }, { status: 404 });
    }
    // needs-speaker and one-way are both refusals a moderator can act on -- 409, not 400: the
    // request was well-formed, the contribution's current state is what refuses it.
    const status = outcome.reason === "malformed" ? 400 : 409;
    return Response.json({ error: outcome.message, kind: outcome.reason }, { status });
  }

  return Response.json({ contribution: outcome.contribution });
}
