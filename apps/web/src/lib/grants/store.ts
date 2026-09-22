/**
 * language_grant: the only module that knows its columns.
 *
 * Read once per request (viewerOf is wrapped in React's cache), because a page and the
 * routes it calls ask "may this person do that here" many times over and the answer does
 * not change inside one request.
 */
import "server-only";

import { cache } from "react";

import { query } from "@/lib/db";
import { isLang } from "@/lib/lang";
import { isCapability, type Capability, type Grant, type Viewer } from "@/lib/permissions";

export async function grantsOf(userId: string): Promise<Grant[]> {
  const rows = await query<{ lang: string; capability: string }>(
    `select "lang", "capability" from "language_grant" where "userId" = $1
      order by "lang", "capability"`,
    [userId],
  );
  return rows.filter((row) => isCapability(row.capability)) as Grant[];
}

/** Who a session belongs to, with their grants. Null for nobody signed in. */
export const viewerOf = cache(
  async (
    session: { user: { id: string; role?: string | null } } | null,
  ): Promise<Viewer | null> => {
    if (!session) return null;
    return { role: session.user.role, grants: await grantsOf(session.user.id) };
  },
);

export type GrantRow = {
  userId: string;
  email: string;
  name: string | null;
  lang: string;
  capability: Capability;
  grantedAt: string;
};

/** Every grant in the given languages, or in all of them, with who holds it. */
export async function listGrants(langs?: string[]): Promise<GrantRow[]> {
  const rows = await query<Omit<GrantRow, "grantedAt"> & { grantedAt: Date }>(
    `select g."userId", u."email", u."name", g."lang", g."capability", g."grantedAt"
       from "language_grant" g join "user" u on u."id" = g."userId"
      where $1::text[] is null or g."lang" = any($1::text[])
      order by g."lang", u."email", g."capability"`,
    [langs ?? null],
  );
  return rows.map((row) => ({ ...row, grantedAt: row.grantedAt.toISOString() }));
}

export async function addGrant(
  userId: string,
  lang: string,
  capability: Capability,
  grantedBy: string,
): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  await query(
    `insert into "language_grant" ("userId", "lang", "capability", "grantedBy")
     values ($1, $2, $3, $4)
     on conflict ("userId", "lang", "capability") do nothing`,
    [userId, lang, capability, grantedBy],
  );
}

export async function removeGrant(userId: string, lang: string, capability: Capability): Promise<void> {
  await query(
    `delete from "language_grant" where "userId" = $1 and "lang" = $2 and "capability" = $3`,
    [userId, lang, capability],
  );
}

/** Somebody to grant to, found by email: a language admin cannot list the users. */
export async function userByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const rows = await query<{ id: string; email: string }>(
    `select "id", "email" from "user" where lower("email") = lower($1)`,
    [email.trim()],
  );
  return rows[0] ?? null;
}
