import type { Source } from "@/lib/sections";
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
 *                 archives each take as it is cut.
 *   zones, books  `v{version}.mp3`.
 *
 * Versions are 1-based. A `0.mp3` left on disk by the version-0 convention this app used to
 * have is not renamed and not deleted -- archived audio never is -- but no row points at
 * one, and nothing here will produce that name again.
 *
 * There used to be more in this file: a parser for history filenames and a sort over them,
 * both written so that a one-time script could pair a directory listing against a file's
 * take rows by position. Nothing pairs anything any more. The row says where its bytes are,
 * or its section's rule does, and a listing of the archive is not consulted by anything the
 * site serves.
 */

/** The name a take is archived under, per its section's rule. */
export function archiveNameFor(source: Source, version: number): string {
  // Quests has always named an archived take after its version, and renaming 9,000 files to
  // match the other two would be renaming irreplaceable audio to tidy a spelling.
  return source === "quests" ? `${version}.mp3` : `v${version}.mp3`;
}
