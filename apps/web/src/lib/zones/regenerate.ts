/**
 * Narrating one zone line, on the shared queue's terms.
 *
 * What the zones site had here was a batch runner: a Map of batches on globalThis, its own
 * concurrency limiter, its own rate-limit backoff, its own stop flag. All of that is the
 * queue's now (lib/generation/queue.ts, worker.ts), which is what let its pm2 config stop
 * pinning a single worker. What is left is the part that is actually about zone lore:
 * which text, which voice, where the bytes go, and what the take records.
 *
 * The result is the quests side's RegenerateResult, not an exception, because the worker
 * decides what to do next from `kind` and `fatal`: running out of credits fails every
 * remaining line identically and stops the batch, while one line whose text cannot be
 * voiced is just one line.
 *
 * THE REQUEST ITSELF IS lib/generation/tts.ts, the same client quests and books narrate
 * through. Zones used to reach into pipelines/zones/tools/voice/elevenlabs.mjs for it,
 * which left the repository with two ElevenLabs clients and put one of them in a pipeline
 * that does no generating. One client means one retry policy, one failure taxonomy and one
 * place a request's shape is decided.
 */
import "server-only";

import { stat } from "node:fs/promises";

import { failure } from "@/lib/generation/errors";
import type { RegenerateResult } from "@/lib/generation/regenerate";
import { textToSpeech } from "@/lib/generation/tts";

import { archiveNameFor } from "@/lib/takes/archive";
import { noteArchiveFile } from "@/lib/takes/store";

import { catalogue, type CatalogueEntry } from "./catalogue";
import {
  archiveLive,
  archiveTake,
  buildLookup,
  durationOf,
  exportManifest,
  insertTake,
  writeAudio,
} from "./tools";
import { narratorConfig, NarratorMissing, type VoiceConfig } from "./voice";

/**
 * Resolving the narrator can fail before any request is made.
 *
 * Only this one kind now: textToSpeech returns its own classified failure rather than
 * throwing, so there is nothing to recover from a message.
 */
function asFailure(error: unknown) {
  if (error instanceof NarratorMissing) return failure("voice-missing", error.message);
  return failure("upstream", error instanceof Error ? error.message : String(error));
}

async function takeFor(
  entry: CatalogueEntry,
  config: VoiceConfig,
  path: string,
  credits: number | null,
  leadIn: { leadIn: boolean; leadInSec: number | null },
) {
  return {
    file: entry.file,
    textHash: entry.hash,
    chars: entry.spoken.length,
    credits,
    durationSec: await durationOf(path),
    bytes: (await stat(path)).size,
    voiceId: config.voiceId ?? null,
    modelId: config.modelId,
    outputFormat: config.outputFormat,
    dictionaryId: config.dictionaryId ?? null,
    dictionaryVersionId: config.dictionaryVersionId ?? null,
    ...leadIn,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The addon resolves every clip through Sounds.lua, so a take that is not in it is
 * unreachable and a stale duration resets the Play button at the wrong moment.
 *
 * Exported rather than called per line: buildLookup rewrites the whole 1353-row table, and
 * doing that once per line would be the slowest part of a run that is otherwise waiting on
 * ElevenLabs. The queue calls it once when it drains.
 */
export async function publish(): Promise<void> {
  await exportManifest();
  await buildLookup();
}

async function entryFor(lineId: string): Promise<CatalogueEntry | undefined> {
  return (await catalogue()).find((candidate) => candidate.id === lineId);
}

/**
 * One line, narrated and recorded.
 *
 * The signature is the queue's Generator: which line, whose provenance, whose credits.
 */
export async function regenerateZoneLine(
  lineId: string,
  createdBy: string,
  options: { apiKey: string },
): Promise<RegenerateResult> {

  const entry = await entryFor(lineId);
  if (!entry) {
    return { ok: false, failure: { ...failure("bad-request", `no line ${lineId}`), status: 404 } };
  }

  // A line with no text at all is not a failure of this request, so it is a
  // bad-request rather than an upstream one.
  if (!entry.spoken.trim()) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} has no text to narrate`),
        status: 409,
        fatal: false,
      },
    };
  }

  let config: VoiceConfig;
  try {
    config = await narratorConfig(options.apiKey);
  } catch (error) {
    return { ok: false, failure: asFailure(error) };
  }

  // No seed: a zone line is narrated once and re-rolled by hand if it comes out wrong,
  // so there is nothing to reproduce bit for bit.
  const speech = await textToSpeech(
    {
      voiceId: config.voiceId!,
      text: entry.spoken,
      modelId: config.modelId,
      voiceSettings: config.voiceSettings,
      seed: null,
      dictionary:
        config.dictionaryId && config.dictionaryVersionId
          ? { dictionaryId: config.dictionaryId, versionId: config.dictionaryVersionId }
          : null,
    },
    { apiKey: options.apiKey },
  );
  if (!speech.ok) return { ok: false, failure: speech.failure };
  // Already trimmed of its lead-in by tts.ts: what is written here is what the addon plays.
  const { audio, credits } = speech;

  try {
    // The clip about to be replaced, archived under the take it belongs to. Usually a
    // no-op -- every take cut since takes were archived by version already has its copy --
    // but an imported clip has a row and no archive entry, and overwriting that would
    // destroy audio nothing can reproduce.
    await archiveLive(entry.file);

    const path = await writeAudio(entry.file, audio);

    const version = await insertTake(
      entry.id,
      await takeFor(entry, config, path, credits, speech),
      "generated",
      // Unlike an imported take, this one knows exactly what it was made with, so a
      // version that sounded right can be reproduced after the settings have moved on.
      config.voiceSettings,
    );

    // After the row, because only the row knows the version: the archived file is named
    // after the take it holds, which is what makes a restore a statement about which take
    // is live rather than a guess about which clip is which.
    await archiveTake(entry.file, version);
    await noteArchiveFile("zones", entry.file, version, archiveNameFor("zones", version));

    return {
      ok: true,
      lineId,
      file: entry.file,
      version,
      bytes: (await stat(path)).size,
      characters: entry.spoken.length,
      credits,
      // No seed. The quests side derives one per NPC so a file shared by several of them
      // regenerates the same way whichever row the button was pressed on; here every line
      // has a file of its own and one narrator, so there is nothing to hold steady.
      seed: null,
      voice: config.voiceName,
      // narratorConfig resolves this or throws, so it is set by the time we are here.
      voiceId: config.voiceId!,
      dictionaryVersion: config.dictionaryVersionId ?? null,
      spokenText: entry.spoken,
      // Nothing else plays this file: naming.mjs gives every line its own, which is the
      // whole difference from a gossip file named after its text.
      sharedWith: 0,
      // Version 0 inherited audio is a quests idea -- there, the app took over a store the
      // Python CLI had already filled. Here the first take this app writes is a new row
      // beside the imported one, so there is never anything to archive on the way in.
      archivedInherited: false,
    };
  } catch (error) {
    return { ok: false, failure: asFailure(error) };
  }
}

