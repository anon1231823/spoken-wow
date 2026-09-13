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

import { auth } from "@/lib/auth";
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
