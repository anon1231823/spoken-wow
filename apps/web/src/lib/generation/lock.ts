/**
 * One regeneration per file at a time, across every worker.
 *
 * pm2 runs two cluster workers and a batch is a loop the browser drives, so two people - or
 * one person with two tabs - can easily aim at the same file. Without a lock the two takes
 * race: both archive the same "current" file, both write the store, and the version rows
 * describe an ordering that did not happen.
 *
 * A Postgres advisory lock rather than a file lock, because the contenders are separate
 * processes that already share a database, and rather than a row lock because the thing
 * being protected is a file, which has no row until the work succeeds.
 *
 * Session-scoped, not transaction-scoped: the protected section makes an HTTP call to
 * ElevenLabs and takes seconds, and holding a transaction open across that would pin a
 * connection and a snapshot for no benefit. The cost is that the unlock has to be explicit,
 * which is what the finally block is for - a client returned to the pool still holding the
 * lock would block that file until the process restarts.
 */
import { db } from "@/lib/db";
import { BASE_LANG, type Lang } from "@/lib/lang";
import type { Source } from "@/lib/sections";

/**
 * Namespaces these locks away from anything else that might use advisory locks on the same
 * database. Arbitrary, but fixed: "VOIC" as ASCII.
 */
export const LOCK_NAMESPACE = 0x564f4943;

export const BUSY = Symbol("busy");

/**
 * Run `work` holding the lock for `key`, or return BUSY if someone else holds it.
 *
 * Deliberately try-and-fail rather than wait: the caller is an HTTP request with a person
 * watching it, and "that file is being regenerated, try again" is a better answer than a
 * request that hangs for however long an ElevenLabs call takes.
 */
export async function withFileLock<T>(
  key: string,
  work: () => Promise<T>,
): Promise<T | typeof BUSY> {
  const client = await db().connect();
  let held = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1, hashtext($2)) as locked",
      [LOCK_NAMESPACE, key],
    );
    held = rows[0]?.locked === true;
    if (!held) return BUSY;

    return await work();
  } finally {
    if (held) {
      // Best effort: if the unlock itself fails the connection is broken, and Postgres
      // releases session locks when the connection goes away.
      await client
        .query("select pg_advisory_unlock($1, hashtext($2))", [LOCK_NAMESPACE, key])
        .catch(() => {});
    }
    client.release();
  }
}

/**
 * Run `work` holding the lock on one section's file, or return BUSY.
 *
 * The one place the key is built. Every regeneration and every restore goes through here,
 * because excluding each other is the whole point: a restore must not copy a clip into the
 * store while a generation is writing it. When the key was spelled out at each call site,
 * quests regeneration locked `file` and the restore route locked `quests:file`, and the two
 * never excluded each other at all.
 *
 * Namespaced by section, because the sections name files by different frozen rules and
 * nothing guarantees the namespaces stay disjoint. And by language, because a Portuguese
 * take of a file is its own recording with its own version numbers.
 *
 * English keeps the key it always had. Two releases overlap for the length of a pm2 reload,
 * and an English regeneration under the new release must still exclude one under the old.
 */
export function withTakeLock<T>(
  source: Source,
  file: string,
  work: () => Promise<T>,
  lang: Lang = BASE_LANG,
): Promise<T | typeof BUSY> {
  const key = lang === BASE_LANG ? `${source}:${file}` : `${source}:${lang}:${file}`;
  return withFileLock(key, work);
}
