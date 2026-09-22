/**
 * What the signed-in person holds in each language, for the explorers to decide what to
 * draw. The server checks again on every write: this only saves offering a control that
 * would answer 403.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { grantsOf } from "@/lib/grants/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ grants: [] });
  return Response.json({ grants: await grantsOf(session.user.id) });
}
