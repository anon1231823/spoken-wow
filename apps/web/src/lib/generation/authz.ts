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
import { viewerOf } from "@/lib/grants/store";
import { can, canConfigureGeneration, type Capability } from "@/lib/permissions";

export type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

/**
 * The session, or a 403 to return.
 *
 * Returns the session rather than just a verdict because every caller needs the user id for
 * provenance, and fetching it twice would mean two session lookups per regenerated line.
 */
export async function requireRegenerate(
  lang: Lang = BASE_LANG,
): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  return requireCapability("regenerate", lang);
}

/**
 * The session, or a 403, for one capability in one language.
 *
 * English regenerating and editing is what the collaborator role always granted, so for
 * those this answers exactly as canRegenerate did; everything else is lib/permissions.ts's
 * `can`, over the grants the viewer holds.
 */
export async function requireCapability(
  capability: Capability,
  lang: Lang,
): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !can(await viewerOf(session), capability, lang)) {
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
 * A route acting in one language: the language from `?lang=`, and the session if it holds
 * `capability` there. Parsed in that order because what someone may do depends on where.
 */
export async function requireIn(
  request: Request,
  capability: Capability,
): Promise<
  | { lang: Lang; session: NonNullable<Session>; denied: null }
  | { lang: null; session: null; denied: Response }
> {
  const { lang, denied } = await langParam(request);
  if (denied) return { lang: null, session: null, denied };
  const guard = await requireCapability(capability, lang);
  if (guard.denied) return { lang: null, session: null, denied: guard.denied };
  return { lang, session: guard.session, denied: null };
}

/**
 * The session, or a 403, for anybody who regenerates in any language.
 *
 * For what is shared between them: there is one queue and one ElevenLabs budget behind it,
 * and somebody queueing Portuguese is watching the same panel as somebody queueing English.
 */
export async function requireAnyRegenerate(): Promise<
  { session: NonNullable<Session>; denied: null } | { session: null; denied: Response }
> {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  const allowed =
    viewer !== null &&
    (can(viewer, "regenerate", BASE_LANG) ||
      viewer.grants.some((grant) => can(viewer, "regenerate", grant.lang as Lang)));
  if (!session || !allowed) return { session: null, denied: FORBIDDEN() };
  return { session, denied: null };
}
