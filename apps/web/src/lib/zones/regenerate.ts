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
 * voiced is just one line. The pipeline's synthesize() throws, so mapping its failures onto
 * that taxonomy is this module's job and the reason it exists rather than the route calling
 * the pipeline directly.
 */
import "server-only";

import { stat } from "node:fs/promises";

import { classifyUpstream, failure } from "@/lib/generation/errors";
import type { RegenerateResult } from "@/lib/generation/regenerate";

import { catalogue, type CatalogueEntry } from "./catalogue";
import {
  buildLookup,
  durationOf,
  exportManifest,
  insertTake,
  restoreTake,
  synthesize,
  writeAudio,
  type VoiceConfig,
} from "./tools";
import { narratorConfig, NarratorMissing } from "./voice";

/**
 * What the pipeline threw, as a failure the queue understands.
 *
 * synthesize() reports an HTTP failure as `ElevenLabs returned 429: {json}`, having already
 * retried the retryable ones, so the status is recoverable from the message and worth
 * recovering: it is the difference between stopping a batch and moving to the next line.
 * Anything unrecognised is "upstream", which is not fatal -- a batch that stops on a
 * failure nobody has classified is a batch that stops for no reason anybody can act on.
 */
function asFailure(error: unknown) {
  if (error instanceof NarratorMissing) return failure("voice-missing", error.message);

  const message = error instanceof Error ? error.message : String(error);
  const match = /^ElevenLabs returned (\d{3}): ([\s\S]*)$/.exec(message);
  if (match) return classifyUpstream(Number(match[1]), match[2], "narrating this line");

  return failure("upstream", message);
}

async function takeFor(
  entry: CatalogueEntry,
  config: VoiceConfig,
  path: string,
  credits: number | null,
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

  try {
    const { audio, credits } = await synthesize(entry.spoken, config, options.apiKey);

    // Archives the take being replaced. This is what makes a bad re-roll reversible, and
    // the reason writeAudio lives in the pipeline's store rather than in this caller.
    const path = await writeAudio(entry.file, audio);

    const version = await insertTake(
      entry.id,
      await takeFor(entry, config, path, credits),
      "generated",
      // Unlike an imported take, this one knows exactly what it was made with, so a
      // version that sounded right can be reproduced after the settings have moved on.
      config.voiceSettings,
    );

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

/**
 * Puts an archived take back, for free.
 *
 * A new row rather than a flag moved, unlike restoring lore: the bytes on disk are what an
 * addon plays, so putting an older clip back IS generating the current one, and the history
 * should say when that happened. Its credits are null rather than the original's -- this
 * cost nothing, and summing credits over takes should total what was actually spent.
 */
export async function restoreZoneTake(
  lineId: string,
  archiveVersion: number,
): Promise<number> {
  const entry = await entryFor(lineId);
  if (!entry) throw new Error(`unknown lineId ${lineId}`);

  const { query } = await import("@/lib/db");
  const rows = await query<{
    textHash: string;
    chars: number;
    voiceId: string | null;
    modelId: string | null;
    outputFormat: string | null;
    dictionaryId: string | null;
    dictionaryVersionId: string | null;
  }>(
    `select "spokenHash" as "textHash", "characters" as "chars", "voiceId", "modelId",
            "outputFormat", "dictionaryId", "dictionaryVersion" as "dictionaryVersionId"
       from "take"
      where "source" = 'zones' and "lineId" = $1 and "version" = $2`,
    [lineId, archiveVersion],
  );
  const original = rows[0];
  if (!original) throw new Error(`no take at version ${archiveVersion} for ${lineId}`);

  const path = await restoreTake(entry.file, archiveVersion);

  return insertTake(
    lineId,
    {
      file: entry.file,
      // The restored take's own hash, so staleness describes the audio that is now live
      // rather than the audio it displaced.
      textHash: original.textHash,
      chars: original.chars,
      credits: null,
      durationSec: await durationOf(path),
      bytes: (await stat(path)).size,
      voiceId: original.voiceId,
      modelId: original.modelId,
      outputFormat: original.outputFormat,
      dictionaryId: original.dictionaryId,
      dictionaryVersionId: original.dictionaryVersionId,
      generatedAt: new Date().toISOString(),
    },
    "generated",
  );
}
