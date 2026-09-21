/**
 * Committing a take.
 *
 * Going back to one lives in lib/takes/restore.ts now, with the other two sections': what
 * a restore is -- copy the archived clip into the store, move the live flag -- is the same
 * in all three, and only the paths differed.
 *
 * The two operations that must keep the store, the history directory and the version table
 * agreeing. Everything here assumes the caller already holds the file's lock (lock.ts) - the
 * sequences below are not atomic and are not safe to interleave.
 *
 * Ordering is chosen so that a crash leaves recoverable state:
 *
 *   1. archive what is in the store, before anything overwrites it
 *   2. write the new bytes
 *   3. record the row and mark it current
 *
 * A crash between 2 and 3 leaves a store file with no row, which reads as inherited audio
 * and archives correctly on the next attempt. The reverse order would lose the previous take
 * outright, which is the one outcome worth engineering against.
 */
import { createHash } from "node:crypto";

import { liveVersionOf, nextVersion, recordVersion, setCurrentVersion } from "./versions";
import { archiveStoreFile, storeFileExists, writeStoreFile } from "./archive";
import type { VoiceSettings } from "./config";
import type { VoicelineVersion } from "./versions";

export type CommitInput = {
  file: string;
  data: Buffer;
  /** Whether the request carried a lead-in, and how much was trimmed off the stored audio. */
  leadIn: boolean;
  leadInSec: number | null;
  lineId: string;
  voice: string;
  voiceId: string;
  /** The narrator that read this take's stage directions, or null for a single-voice take. */
  narratorVoice: string | null;
  modelId: string;
  seed: number | null;
  characters: number;
  /** From the response header; null when ElevenLabs did not report one. */
  credits: number | null;
  /**
   * The settings actually sent. A dialogue take carries only `stability`, because that is
   * all the text-to-dialogue endpoint accepts - recording the other three would describe a
   * take that never had them.
   */
  settings: VoiceSettings | Pick<VoiceSettings, "stability">;
  /**
   * The text actually sent, and the dictionary version applied to it.
   *
   * Passed rather than derived, because only the caller knows both: the text has already
   * been through applyPronunciation by the time it gets here, and the locator comes from
   * the lexicon row. Hashed here so there is one definition of what "the same pronunciation"
   * means, rather than one per call site.
   */
  spokenText: string;
  dictionaryVersion: string | null;
  createdBy: string;
};

export type CommitResult = {
  version: number;
  bytes: number;
  /** Set when the take being replaced had to be archived before this one overwrote it. */
  archivedLive: boolean;
};

/**
 * Copy the take that is live now into the archive, before new bytes land on top of it.
 *
 * The single most important step in this module, and the one thing here that may not be
 * skipped: the store holds exactly one clip per line, so writing a new take destroys the
 * old one unless it has already been copied out. Doing it here rather than at the call
 * site means neither generation nor restore can forget.
 *
 * WHICH VERSION IT IS COMES FROM THE DATABASE. The live row says what the bytes in the
 * store are; the archive is where they go. This used to invent a version 0 for a file with
 * no rows -- audio "predating the app" -- and read the history directory to decide whether
 * to. Both are gone: a version number is a thing the table issues, and there is no number
 * meaning "the take before the first take".
 *
 * A store file with no row at all is the one case left, and it refuses rather than guessing
 * a number for it. See below.
 *
 * Re-copying a take that was already archived at the moment it was cut is deliberate and
 * cheap: the bytes are the same, so the write is idempotent, and the alternative is a stat
 * that makes the archive authoritative again for a question the table can answer.
 */
async function archiveLive(file: string): Promise<boolean> {
  const live = await liveVersionOf(file);
  const inStore = await storeFileExists(file);

  // A clip with no take row is audio the database does not know exists, and there is no
  // version number to archive it under. Writing over it would destroy a take nothing could
  // name afterwards, so this refuses instead. It is not a disagreement to paper over: every
  // clip in the store is meant to have a row, and scripts/seed-quests-takes.mjs is what
  // gave the ones narrated before this app kept records theirs.
  if (live === null && inStore) {
    throw new Error(
      `${file} has audio in the store but no take row, so a re-roll would destroy a take ` +
        "nothing recorded. Give it a row before generating over it.",
    );
  }
  if (live === null || !inStore) return false;

  await archiveStoreFile(file, live);
  return true;
}

/**
 * What a take was pronounced with, as a comparable value.
 *
 * sha-256 of the spoken text, hex. Not a cryptographic requirement - nothing here is
 * adversarial - but a stable, short, collision-free-in-practice identity for a string that
 * can run to a few thousand characters, so staleness is one column comparison rather than a
 * copy of every line's text in the version table.
 */
export function spokenHash(spokenText: string): string {
  return createHash("sha256").update(spokenText, "utf8").digest("hex");
}

/** Write a new take into the store and record it. Caller must hold the file's lock. */
export async function commitVersion(input: CommitInput): Promise<CommitResult> {
  const archivedLive = await archiveLive(input.file);

  // From the rows, and only the rows. This used to take the larger of the table's next
  // number and one past the highest file in the history directory, to survive a row going
  // missing. That made the filesystem a second register of what exists, which is the thing
  // the take table is for -- and on a machine whose archive is mounted elsewhere it read as
  // "no history" and handed out a number already in use.
  const version = await nextVersion(input.file);

  await writeStoreFile(input.file, input.data);

  await archiveStoreFile(input.file, version);
  await recordVersion({
    file: input.file,
    version,
    origin: "generated",
    lineId: input.lineId,
    voice: input.voice,
    narratorVoice: input.narratorVoice,
    bytes: input.data.byteLength,
    voiceId: input.voiceId,
    modelId: input.modelId,
    seed: input.seed,
    characters: input.characters,
    credits: input.credits,
    settings: input.settings,
    spokenHash: spokenHash(input.spokenText),
    dictionaryVersion: input.dictionaryVersion,
    leadIn: input.leadIn,
    leadInSec: input.leadInSec,
    createdBy: input.createdBy,
  });
  await setCurrentVersion(input.file, version);

  return { version, bytes: input.data.byteLength, archivedLive };
}
