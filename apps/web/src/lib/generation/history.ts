/**
 * Committing a take, and going back to an earlier one.
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
 *   4. prune
 *
 * A crash between 2 and 3 leaves a store file with no row, which reads as inherited audio
 * and archives correctly on the next attempt. The reverse order would lose the previous take
 * outright, which is the one outcome worth engineering against.
 */
import { createHash } from "node:crypto";

import { deleteVersions, listVersions, nextVersion, recordVersion, setCurrentVersion } from "./versions";
import {
  archiveStoreFile,
  INHERITED_VERSION,
  pruneVersionFiles,
  restoreVersionFile,
  storeFileExists,
  versionsOnDisk,
  versionsToPrune,
  writeStoreFile,
} from "./archive";
import { noteStored } from "@/lib/audio";
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
  pruned: number[];
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
  noteStored(input.file);

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

  const pruned = await prune(input.file);

  return { version, bytes: input.data.byteLength, archivedInherited, pruned };
}

export type RestoreResult = {
  /** The version now live - the one asked for. */
  version: number;
  bytes: number;
  archivedInherited: boolean;
};

/**
 * Put an earlier take back into the store.
 *
 * The current file is archived first even though it is already in history, because it might
 * not be: a store file with no row is inherited audio, and restoring over it without
 * archiving would destroy the very thing history exists to protect. When it is already
 * recorded, archiveInherited sees the rows and does nothing.
 *
 * The restored take keeps its own version number rather than being copied to a new one.
 * History is what happened, not a log of what was looked at, and a restore that invented a
 * version would make "restore v0" produce a v6 that is not the original either.
 */
export async function restoreVersion(file: string, version: number): Promise<RestoreResult> {
  const versions = await listVersions(file);
  const target = versions.find((candidate) => candidate.version === version);
  if (!target) throw new Error(`no version ${version} of ${file}`);

  const onDisk = await versionsOnDisk(file);
  if (!onDisk.includes(version)) {
    throw new Error(`version ${version} of ${file} is recorded but its audio is missing`);
  }

  const archivedInherited = await archiveInherited({
    file,
    lineId: target.lineId,
    voice: target.voice,
  });

  const data = await restoreVersionFile(file, version);
  noteStored(file);
  await setCurrentVersion(file, version);

  return { version, bytes: data.byteLength, archivedInherited };
}

/**
 * Drop everything but version 0 and the newest four, from both disk and the table.
 *
 * Driven by what is on disk rather than by the rows, so it never tries to delete a file that
 * is not there. A row whose audio has already gone - an rsync from elsewhere, a hand-deleted
 * directory - is left alone rather than tidied away: it is still a true record that the take
 * existed, and historyOf marks it unplayable while restoreVersion refuses it outright.
 */
export async function prune(file: string): Promise<number[]> {
  const onDisk = await versionsOnDisk(file);
  const doomed = versionsToPrune(onDisk);
  if (doomed.length === 0) return [];

  await pruneVersionFiles(file, doomed);
  await deleteVersions(file, doomed);
  return doomed;
}

/** History for one file, with takes whose audio has gone marked unrestorable. */
export async function historyOf(
  file: string,
): Promise<(VoicelineVersion & { playable: boolean })[]> {
  const [versions, onDisk] = await Promise.all([listVersions(file), versionsOnDisk(file)]);
  const present = new Set(onDisk);
  return versions.map((version) => ({ ...version, playable: present.has(version.version) }));
}
