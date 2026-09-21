/**
 * What an archived take is called.
 *
 * Pure, and about naming rather than about what exists: a take's bytes are located from its
 * row -- `archiveFile` when it has one, this rule when it predates that column -- and the
 * filesystem is asked only by the two things that actually touch bytes, the audio route and
 * the restore.
 *
 * Two namings are on disk and both stay readable forever, because archived audio is never
 * renamed or deleted:
 *
 *   quests        `{version}.mp3` -- the number IS the take version, since commitVersion
 *                 archives each take as it is cut. `0.mp3` is the take that predates the
 *                 app (INHERITED_VERSION).
 *   zones, books  `v{version}.mp3` for everything cut since takes were archived by version.
 *                 Older clips there were numbered by position in a sequence of overwrites,
 *                 which is not a version -- those rows are matched to their files once, by
 *                 scripts/backfill-archive-names.mjs, and carry `archiveFile` afterwards.
 */
import type { Source } from "@/lib/generation/queue";

/** The name a take is archived under, per its section's rule. */
export function archiveNameFor(source: Source, version: number): string {
  // Quests has always named an archived take after its version, and renaming 9,000 files to
  // match the other two would be renaming irreplaceable audio to tidy a spelling.
  return source === "quests" ? `${version}.mp3` : `v${version}.mp3`;
}

/** The version a history filename names, or null when the name is not one of ours. */
export function versionInName(name: string): number | null {
  const match = /^v?(\d+)\.mp3$/.exec(name);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

/** History filenames, ascending by the number in them. Anything else is dropped. */
export function sortedArchiveNames(names: readonly string[]): string[] {
  return names
    .filter((name) => versionInName(name) !== null)
    .sort((a, b) => versionInName(a)! - versionInName(b)!);
}

export type TakeRef = {
  version: number;
  /** What the row already claims, when it was cut under the current naming. */
  archiveFile?: string | null;
  isCurrent?: boolean;
};
