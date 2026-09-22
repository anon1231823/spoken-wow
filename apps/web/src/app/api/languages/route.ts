/**
 * Which languages the site serves, and switching one on or off.
 *
 * GET is public: the header's switcher asks it, and an enabled language is no secret. An
 * admin is also told about the languages that are off, so they can open one to prepare it
 * before anybody else sees it. PUT is admin-only.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { langName } from "@/lib/lang";
import { languageStates, setEnabled } from "@/lib/languages/store";
import { isAdmin } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  const admin = isAdmin(session?.user.role);
  const states = await languageStates();
  return Response.json({
    languages: states
      .filter((state) => state.enabled || admin)
      .map((state) => ({ code: state.code, name: langName(state.code), enabled: state.enabled })),
  });
}

export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdmin(session.user.role)) {
    return Response.json({ error: "not allowed" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown; enabled?: unknown } | null;
  if (typeof body?.code !== "string" || typeof body.enabled !== "boolean") {
    return Response.json({ error: "expected { code, enabled }" }, { status: 400 });
  }

  try {
    await setEnabled(body.code, body.enabled, session.user.id);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  return GET();
}
