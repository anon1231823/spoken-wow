/**
 * The access boundary for the generation routes.
 *
 * The sibling of lib/voices/authz.ts and 403 for the same reason: the role checks in
 * components only decide what to draw, so the server check cannot be skipped just because
 * the UI would not have offered the control.
 *
 * Two levels. Regenerating and reverting are `collaborator`; changing the global settings is
 * `admin`, because those settings apply to everything anyone generates afterwards.
 */
import { headers } from "next/headers";

import { readApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { BASE_LANG, type Lang } from "@/lib/lang";
import { langParam } from "@/lib/lang-server";
import { NO_API_KEY } from "@/lib/no-api-key";
import { canConfigureGeneration, canRegenerate } from "@/lib/permissions";

export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * The session, or a 403 to return.
 *
 * Returns the session rather than just a verdict because every caller needs the user id for
 * provenance, and fetching it twice would mean two session lookups per regenerated line.
 */
export async function requireRegenerate(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canRegenerate(session.user.role)) {
    return { session: null, denied: FORBIDDEN() };
  }
  return { session, denied: null };
}

export async function requireConfigure(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canConfigureGeneration(session.user.role)) {
    return { session: null, denied: FORBIDDEN() };
  }
  return { session, denied: null };
}

//------------------------------------------------------------------------------
// Credentials
//------------------------------------------------------------------------------

export type KeyGuard = { key: string; denied: null } | { key: null; denied: Response };

function noKey(message: string): Response {
  return Response.json({ error: message, code: "no_api_key" }, { status: NO_API_KEY });
}

/**
 * The signed-in user's own ElevenLabs key, for the routes that spend.
 *
 * Run AFTER a role guard, never instead of one: a key is a credential, not a permission,
 * and a member who pasted one must still be refused.
 *
 * There is no fallback to a server-wide ELEVENLABS_API_KEY, deliberately. With one, "who
 * paid for this line" would have no answer, and granting somebody the collaborator role
 * would quietly grant them the deployer's bill as well.
 */
export async function requireApiKey(userId: string): Promise<KeyGuard> {
  let key: string | null;
  try {
    key = await readApiKey(userId);
  } catch {
    // A row that will not open means SPOKEN_SECRET_KEY changed under it. Saving the key
    // again is the fix, so this points at the same page as having none at all -- but it
    // says which of the two happened.
    return {
      key: null,
      denied: noKey("Your stored ElevenLabs key could not be read. Set it again in your profile."),
    };
  }

  if (!key) {
    return { key: null, denied: noKey("This spends ElevenLabs credits, and you have no key set.") };
  }

  return { key, denied: null };
}

//------------------------------------------------------------------------------
// Language
//------------------------------------------------------------------------------

/**
 * The language a generation request is in, if this build can generate in it.
 *
 * English only, for now: the generators read English text and commit English takes, and a
 * request for another language would come back as an English recording filed under the
 * wrong one. The worker refuses the same jobs (worker.ts), so a batch queued some other way
 * still fails whole rather than spending anything.
 */
export async function requireGenerationLang(
  request: Request,
): Promise<{ lang: Lang; denied: null } | { lang: null; denied: Response }> {
  const { lang, denied } = await langParam(request);
  if (denied) return { lang: null, denied };
  if (lang !== BASE_LANG) {
    return {
      lang: null,
      denied: Response.json(
        { error: `generating in ${lang} is not supported yet`, kind: "bad-request" },
        { status: 400 },
      ),
    };
  }
  return { lang, denied: null };
}
