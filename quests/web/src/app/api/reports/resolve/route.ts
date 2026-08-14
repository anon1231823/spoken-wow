/**
 * Changing a report's status.
 *
 * A separate route rather than a second verb on /api/reports. That path's POST is open to the
 * whole internet and this one must never be; two verbs on one path with opposite access rules
 * is the arrangement a later edit quietly breaks.
 *
 * Collaborator rather than admin: these are the people who already act on lines, and a report
 * they have read and dismissed should not need an admin to close.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { isStatus } from "@/lib/reports/reports";
import { setStatus } from "@/lib/reports/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { id?: unknown; status?: unknown };

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }
  if (!isStatus(body.status)) {
    return Response.json({ error: "unknown status" }, { status: 400 });
  }

  const report = await setStatus(id, body.status, session.user.id);
  if (!report) {
    return Response.json({ error: "unknown report" }, { status: 404 });
  }

  return Response.json({ report });
}
