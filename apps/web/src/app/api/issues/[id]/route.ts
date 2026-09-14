/**
 * Deciding what to do about one finding.
 *
 * `admin`, matching the lexicon's PUT: dismissing a finding stops it marking lines for
 * everyone, which is the same kind of decision as adding a pronunciation rule.
 *
 * PATCH rather than PUT because a verdict really is a partial update - the detection beside it
 * belongs to the scan, and a whole-object write would invite a client to send counts back.
 */
import { requireConfigure } from "@/lib/generation/authz";
import { IssueError, validateVerdict } from "@/lib/issues/issues";
import { issueList, setVerdict } from "@/lib/issues/store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return Response.json({ error: "unknown issue" }, { status: 404 });
  }

  let decision;
  try {
    decision = validateVerdict(await request.json());
  } catch (error) {
    // A validation failure is the caller's fault and a JSON parse failure is too, so both are
    // 400 - but only IssueError text is safe to hand back verbatim.
    const message = error instanceof IssueError ? error.message : "invalid verdict body";
    return Response.json({ error: message }, { status: 400 });
  }

  await setVerdict(id, decision.verdict, decision.note, session.user.id);

  // Answer with a fresh read, as the settings and lexicon routes do, so the client can treat
  // the response as the new truth rather than assuming its own edit landed.
  const [issue] = await issueList({ includeUndetected: true, id });
  if (!issue) return Response.json({ error: "unknown issue" }, { status: 404 });
  return Response.json({ issue });
}
