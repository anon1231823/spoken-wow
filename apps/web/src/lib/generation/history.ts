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

import { listVersions, nextVersion, recordVersion, setCurrentVersion } from "./versions";
import {
  archiveStoreFile,
  INHERITED_VERSION,
  storeFileExists,
  versionsOnDisk,
  writeStoreFile,
} from "./archive";
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
  /** Set when audio that predated this app was archived to make room for this take. */
  archivedInherited: boolean;
};

/**
 * Archive whatever is in the store as version 0, if this file has no history yet.
 *
 * The single most important step in this module. Audio produced before this app existed
 * cannot be reproduced - the settings, the seed and often the voice are all unknown - so the
 * first regeneration is the only chance to keep it. Doing it here rather than at the call
 * site means neither generation nor restore can forget.
 */
async function archiveInherited(input: {
  file: string;
  lineId: string;
  voice: string;
}): Promise<boolean> {
  const [existing, onDisk] = await Promise.all([
    listVersions(input.file),
    versionsOnDisk(input.file),
  ]);

  // The disk is consulted as well as the table, and this is not belt and braces. If the rows
  // are gone but the takes are not - a restored backup, a hand-run delete, a fresh database
  // pointed at an existing audio-history - then trusting the table alone would archive the
  // *current* take as version 0 and overwrite the real original with it. That is the one
  // outcome this whole module exists to prevent, and it is unrecoverable.
  if (existing.length > 0 || onDisk.length > 0) return false;
  if (!(await storeFileExists(input.file))) return false;

  const bytes = await archiveStoreFile(input.file, INHERITED_VERSION);
  await recordVersion({
    file: input.file,
    version: INHERITED_VERSION,
    origin: "inherited",
    lineId: input.lineId,
    voice: input.voice,
    bytes,
    // No settings, model or seed: nothing recorded how this was made, and guessing would be
    // worse than the honest gap - it would suggest the take could be reproduced.
    createdBy: null,
  });
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
  const archivedInherited = await archiveInherited(input);

  // Past the highest number either side has seen. Taking it from the table alone would let a
  // lost row hand out a number that already names a file, and archiveStoreFile would write
  // straight over that take.
  const [fromRows, onDisk] = await Promise.all([
    nextVersion(input.file),
    versionsOnDisk(input.file),
  ]);
  const version = Math.max(fromRows, onDisk.length ? Math.max(...onDisk) + 1 : 0);

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

  return { version, bytes: input.data.byteLength, archivedInherited };
}
