/**
 * The pronunciation lexicon.
 *
 * The same boundary as the generation settings, and for the same reason: GET is
 * `collaborator`, because someone about to spend characters is entitled to know how the
 * names in their line will be said, and PUT/DELETE are `admin`, because a phoneme rule
 * applies to everything anyone generates afterwards.
 *
 * PUT answers 200 even when the upload to ElevenLabs failed. The save itself succeeded, the
 * stored entries are what the page should now show, and reporting that as an error would
 * invite an admin to retype an edit that is already safely in Postgres. `syncError` and the
 * `pending` state carry the bad news instead, and POST retries just the upload.
 */
import { requireApiKey, requireIn } from "@/lib/generation/authz";
import { readLexicon, resync, writeLexicon } from "@/lib/generation/dictionary";
import { LexiconError, validateLexicon } from "@/lib/generation/lexicon";

export const dynamic = "force-dynamic";

// Each language has a lexicon of its own (?lang=, English when absent): read by whoever
// regenerates in it, changed by whoever configures it.
export async function GET(request: Request) {
  const { lang, denied } = await requireIn(request, "regenerate");
  if (denied) return denied;
  return Response.json(await readLexicon(lang));
}

export async function PUT(request: Request) {
  const { session, lang, denied } = await requireIn(request, "configure");
  if (denied) return denied;

  // The upload spends nothing, but it is a write to the admin's own ElevenLabs account and
  // there is no server key to make it with. Refusing before the save keeps the two in step:
  // a lexicon stored here that no dictionary anywhere reflects is the state `pending` exists
  // to report, not one to create on purpose.
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  let entries;
  try {
    entries = validateLexicon(await request.json());
  } catch (error) {
    // A validation failure is the caller's fault and a JSON parse failure is too, so both are
    // 400 - but only LexiconError text is safe to hand back verbatim.
    const message = error instanceof LexiconError ? error.message : "invalid lexicon body";
    return Response.json({ error: message }, { status: 400 });
  }

  const { lexicon, syncError } = await writeLexicon(
    entries,
    session.user.id,
    { apiKey: key },
    lang,
  );
  return Response.json({ ...lexicon, syncError });
}

/** Retry the upload for a lexicon already saved. */
export async function POST(request: Request) {
  const { session, lang, denied } = await requireIn(request, "configure");
  if (denied) return denied;

  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const syncError = await resync({ apiKey: key }, lang);
  return Response.json({ ...(await readLexicon(lang)), syncError });
}
