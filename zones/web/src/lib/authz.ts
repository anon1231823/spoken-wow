/**
 * The access boundary for the API routes that change something.
 *
 * The role checks in components only decide what to draw, so the check cannot be skipped
 * just because the UI would not have offered the control -- /api/regenerate is one curl
 * away from anyone who reads the page source, and it spends real money.
 *
 * Three levels, matching permissions.ts: reviewing a line, regenerating one, and editing
 * the pronunciation rules.
 *
 * 403, not 401, and no WWW-Authenticate: there is nothing for a browser to prompt for, and
 * the fetch callers in Explorer treat any non-ok response the same way.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { canConfigure, canRegenerate, canReview } from "@/lib/permissions";

type Session = Awaited<ReturnType<typeof auth.api.getSession>>;

export type Guard =
  | { session: NonNullable<Session>; denied: null }
  | { session: null; denied: NextResponse };

const FORBIDDEN = () =>
  NextResponse.json({ error: "not allowed" }, { status: 403 });

async function require(allowed: (role: string | null | undefined) => boolean): Promise<Guard> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !allowed(session.user.role)) return { session: null, denied: FORBIDDEN() };
  return { session, denied: null };
}

/** Flagging a line, and writing a note on one. */
export const requireReview = () => require(canReview);

/** Spending credits, and restoring an archived take. */
export const requireRegenerate = () => require(canRegenerate);

/** Reading and writing tools/voice/pronunciation.json. */
export const requireConfigure = () => require(canConfigure);

/** The session, whoever it belongs to, or null. For pages that render either way. */
export async function currentSession(): Promise<Session> {
  return auth.api.getSession({ headers: await headers() });
}
