/**
 * Who may do what in which language.
 *
 * A global admin sees and changes every grant. Somebody who is `admin` in a language sees
 * that language's and may hand out `edit` and `regenerate` in it -- enough to bring
 * translators in without an admin, not enough to decide the language's settings or make
 * another admin. lib/permissions.ts `canGrant` is the rule; this only applies it.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { addGrant, listGrants, removeGrant, userByEmail, viewerOf } from "@/lib/grants/store";
import { isLang } from "@/lib/lang";
import { canGrant, isCapability, type Viewer } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const FORBIDDEN = () => Response.json({ error: "not allowed" }, { status: 403 });

async function viewer(): Promise<{ viewer: Viewer; userId: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  const seen = await viewerOf(session);
  return session && seen ? { viewer: seen, userId: session.user.id } : null;
}

/** The languages somebody administers, or null for all of them. */
function administered(viewer: Viewer): string[] | null {
  if (viewer.role === "admin") return null;
  return viewer.grants.filter((grant) => grant.capability === "admin").map((grant) => grant.lang);
}

export async function GET() {
  const who = await viewer();
  if (!who) return FORBIDDEN();
  const langs = administered(who.viewer);
  if (langs !== null && langs.length === 0) return FORBIDDEN();
  return Response.json({ grants: await listGrants(langs ?? undefined), languages: langs });
}

export async function PUT(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    lang?: unknown;
    capability?: unknown;
  };
  if (typeof body.email !== "string" || !isLang(body.lang) || !isCapability(body.capability)) {
    return Response.json({ error: "expected { email, lang, capability }" }, { status: 400 });
  }
  if (!canGrant(who.viewer, body.capability, body.lang)) return FORBIDDEN();

  // By email, not by id: a language admin cannot list the users, and an address is what
  // a translator gives somebody when asking to be let in.
  const user = await userByEmail(body.email);
  if (!user) return Response.json({ error: `nobody has registered as ${body.email}` }, { status: 404 });

  await addGrant(user.id, body.lang, body.capability, who.userId);
  return GET();
}

export async function DELETE(request: Request) {
  const who = await viewer();
  if (!who) return FORBIDDEN();

  const params = new URL(request.url).searchParams;
  const userId = params.get("userId");
  const lang = params.get("lang");
  const capability = params.get("capability");
  if (!userId || !isLang(lang) || !isCapability(capability)) {
    return Response.json({ error: "userId, lang and capability are required" }, { status: 400 });
  }
  if (!canGrant(who.viewer, capability, lang)) return FORBIDDEN();

  await removeGrant(userId, lang, capability);
  return GET();
}
