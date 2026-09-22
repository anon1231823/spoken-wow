/**
 * Which languages the site serves: the `language` table, and the only module that knows its
 * columns.
 *
 * What a language IS is code (lib/lang.ts), because the proxy validates a URL prefix without
 * a database. Whether one is switched ON is here, because it is an admin's decision taken at
 * runtime -- a language with nothing translated yet should not be one click away in the
 * header, and turning it on should not need a deploy.
 *
 * English is always on. It is what a bare URL means, and a site that could switch it off
 * would have no pages at all; setEnabled refuses to.
 */
import "server-only";

import { query } from "@/lib/db";
import { BASE_LANG, CODES, isLang, type Lang } from "@/lib/lang";

export type LanguageState = { code: Lang; enabled: boolean };

/** Every language the site knows of, in the list's order, with whether it is on. */
export async function languageStates(): Promise<LanguageState[]> {
  const rows = await query<{ code: string; enabled: boolean }>(
    `select "code", "enabled" from "language"`,
  );
  const enabled = new Set(rows.filter((row) => row.enabled).map((row) => row.code));
  return CODES.map((code) => ({ code, enabled: code === BASE_LANG || enabled.has(code) }));
}

export async function enabledLanguages(): Promise<Lang[]> {
  return (await languageStates()).filter((state) => state.enabled).map((state) => state.code);
}

export async function isEnabled(lang: Lang): Promise<boolean> {
  if (lang === BASE_LANG) return true;
  const rows = await query<{ enabled: boolean }>(
    `select "enabled" from "language" where "code" = $1`,
    [lang],
  );
  return rows[0]?.enabled === true;
}

export async function setEnabled(lang: string, enabled: boolean, userId: string): Promise<void> {
  if (!isLang(lang)) throw new Error(`${lang} is not a language this site knows`);
  if (lang === BASE_LANG) throw new Error("English cannot be switched off");
  await query(
    `insert into "language" ("code", "enabled", "updatedAt", "updatedBy")
     values ($1, $2, now(), $3)
     on conflict ("code") do update
        set "enabled" = excluded."enabled", "updatedAt" = now(), "updatedBy" = excluded."updatedBy"`,
    [lang, enabled, userId],
  );
}
