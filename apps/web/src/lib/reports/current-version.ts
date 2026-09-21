/**
 * Which take of a file is live, for cache-busting the audio a reporter is sent back to check.
 *
 * Without it, someone returning to hear a fix hears the browser's cached copy of the very clip
 * they complained about, and reports it a second time.
 */
import { liveVersion } from "@/lib/takes/store";

export async function currentVersion(file: string): Promise<number | null> {
  return liveVersion("quests", file);
}
