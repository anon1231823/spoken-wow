/**
 * Which lines this project has decided never to voice.
 *
 * `admin`, not `collaborator`: an override changes one file and the person who rewrote it
 * listens to the result, but ignoring a line hides it from everyone's searches and takes it
 * out of the shipped module. That is the same reach as the generation settings, so it is
 * gated the same way.
 *
 * Keyed on the corpus's own lineId, and lineIndex() is the whitelist: an id either names
 * lines the corpus has or it does not exist. Nothing here touches a path, so there is no
 * traversal to defend against - only a table that should not fill with ids nobody can resolve.
 */
import { lineIndex } from "@/lib/corpus";
import { requireConfigure } from "@/lib/generation/authz";
import { clearIgnore, writeIgnore } from "@/lib/quests/ignores";

export const dynamic = "force-dynamic";

/** Long enough for a sentence and a link, short enough not to be an essay in a table cell. */
const MAX_REASON = 300;

export async function PUT(request: Request) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { lineId, reason } = (body ?? {}) as { lineId?: unknown; reason?: unknown };
  if (typeof lineId !== "string" || !lineIndex().has(lineId)) {
    return Response.json({ error: "unknown line" }, { status: 404 });
  }
  if (typeof reason !== "string" || !reason.trim()) {
    // Required, because the list is read months later by someone deciding whether the entry
    // still holds, and "it was broken" with no note is a decision nobody can revisit.
    return Response.json({ error: "a reason is required" }, { status: 400 });
  }
  if (reason.length > MAX_REASON) {
    return Response.json({ error: `reason must be ${MAX_REASON} characters or fewer` }, { status: 400 });
  }

  const ignore = await writeIgnore(lineId, reason, session.user.id);
  return Response.json({ ignore });
}

export async function DELETE(request: Request) {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const lineId = new URL(request.url).searchParams.get("lineId");
  if (!lineId || !lineIndex().has(lineId)) {
    return Response.json({ error: "unknown line" }, { status: 404 });
  }

  // 200 for a line that was not ignored, as the override route does: the caller asked for it
  // to be gone and it is gone, and a 404 would make a second click look like a failure.
  return Response.json({ removed: await clearIgnore(lineId) });
}
