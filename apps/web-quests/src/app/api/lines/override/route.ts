/**
 * What one line should say instead of what the corpus says it says.
 *
 * `collaborator`, matching regeneration rather than the lexicon: an override changes one file,
 * and the person who would have to listen to the result is the person regenerating it. A
 * lexicon rule, by contrast, applies to everything anyone generates afterwards.
 *
 * Keyed on the file, so the same whitelist that makes the audio routes traversal-proof decides
 * what may be written: a path either names a file some corpus line owns, or it does not exist.
 */
import { corpusFiles } from "@/lib/audio";
import { requireRegenerate } from "@/lib/generation/authz";
import { OverrideError, validateOverride } from "@/lib/issues/override";
import { clearOverride, writeOverride } from "@/lib/issues/overrides";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  let draft;
  try {
    draft = validateOverride(await request.json());
  } catch (error) {
    // A validation failure is the caller's fault and a JSON parse failure is too, so both are
    // 400 - but only OverrideError text is safe to hand back verbatim.
    const message = error instanceof OverrideError ? error.message : "invalid override body";
    return Response.json({ error: message }, { status: 400 });
  }

  if (!corpusFiles().has(draft.file)) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }

  const override = await writeOverride(draft.file, draft.lineId, draft.text, session.user.id);
  return Response.json({ override });
}

export async function DELETE(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const file = new URL(request.url).searchParams.get("file");
  if (!file || !corpusFiles().has(file)) {
    return Response.json({ error: "unknown file" }, { status: 404 });
  }

  // Answering 200 for a file that had no override: the caller asked for it to be gone and it
  // is gone, and a 404 would make "revert" fail on a second click.
  return Response.json({ removed: await clearOverride(file) });
}
