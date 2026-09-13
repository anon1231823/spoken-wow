/**
 * Which take of a file is live, for cache-busting the audio a reporter is sent back to check.
 *
 * Without it, someone returning to hear a fix hears the browser's cached copy of the very clip
 * they complained about, and reports it a second time.
 */
import { db } from "@/lib/db";

export async function currentVersion(file: string): Promise<number | null> {
  const { rows } = await db().query<{ version: number }>(
    `select "version" from "take"
      where "source" = 'quests' and "file" = $1 and "isCurrent"`,
    [file],
  );
  return rows[0]?.version ?? null;
}
