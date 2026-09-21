/**
 * Narrating one book page, on the shared queue's terms.
 *
 * lib/zones/regenerate.ts's shape, and deliberately its voice: the design calls for one
 * narrator across the section, and that narrator is the one the zones side already
 * resolves from generation_setting and the pronunciation lexicon. Resolving a second
 * would be a second answer to "who reads this", with nothing asking the question.
 *
 * The result is a RegenerateResult rather than an exception because the worker decides
 * what to do next from `kind` and `fatal`: running out of credits fails every remaining
 * line identically and stops the batch, while one page that cannot be voiced is one page.
 */
import "server-only";

import { stat } from "node:fs/promises";

import { failure } from "@/lib/generation/errors";
import type { RegenerateResult } from "@/lib/generation/regenerate";
import { textToSpeech } from "@/lib/generation/tts";
import { type VoiceConfig } from "@/lib/zones/voice";
import { narratorConfig, NarratorMissing } from "@/lib/zones/voice";

import { catalogue, BASE_LANG, type BookPage } from "./catalogue";
export { publish } from "./publish";
import { archiveNameFor } from "@/lib/takes/archive";
import { noteArchiveFile } from "@/lib/takes/store";

import { durationOf } from "./tools";
import { archiveLive, archiveTake, insertTake, writeAudio } from "./store";

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

async function pageFor(lineId: string, lang: string): Promise<BookPage | undefined> {
  return (await catalogue(lang)).find((candidate) => candidate.id === lineId);
}

export async function regenerateBookLine(
  lineId: string,
  createdBy: string,
  options: { apiKey: string },
): Promise<RegenerateResult> {
  const lang = BASE_LANG;

  const page = await pageFor(lineId, lang);
  if (!page) {
    return { ok: false, failure: { ...failure("bad-request", `no page ${lineId}`), status: 404 } };
  }

  // The 88 pages the game has and nothing can speak: empty, a placeholder, or holding a
  // substitution token the client fills in at runtime. Refused here as well as filtered in
  // the explorer, because the queue can be handed an id directly.
  if (!page.generatable || !page.spoken.trim()) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} cannot be voiced: ${page.skipReason ?? "no text"}`),
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

  // No seed: a page is narrated once and re-rolled by hand if it comes out wrong.
  const speech = await textToSpeech(
    {
      voiceId: config.voiceId,
      text: page.spoken,
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
  // Already trimmed of its lead-in by tts.ts: the store keeps what the addon plays.
  const { audio, credits } = speech;

  try {
    // The clip about to be replaced, archived under the take it belongs to. Usually a
    // no-op -- a take cut since takes were archived by version already has its copy -- but
    // one written before that has a row and no archive entry, and overwriting it would
    // destroy audio that cost credits.
    await archiveLive(page.file, lang);

    const path = await writeAudio(page.file, audio);
    const bytes = (await stat(path)).size;

    const version = await insertTake(
      page.id,
      {
        file: page.file,
        textHash: page.hash,
        chars: page.spoken.length,
        credits,
        durationSec: await durationOf(path),
        bytes,
        voiceId: config.voiceId,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
        dictionaryId: config.dictionaryId ?? null,
        dictionaryVersionId: config.dictionaryVersionId ?? null,
        leadIn: speech.leadIn,
        leadInSec: speech.leadInSec,
        generatedAt: new Date().toISOString(),
      },
      "generated",
      // Unlike an imported take this one knows what it was made with, so a version that
      // sounded right can be reproduced after the settings have moved on.
      config.voiceSettings,
      lang,
    );

    // After the row, because only the row knows the version: the archived file is named
    // after the take it holds, which is what makes a restore a statement about which take
    // is live rather than a guess about which clip is which.
    await archiveTake(page.file, version);
    await noteArchiveFile("books", page.file, version, archiveNameFor("books", version), lang);

    return {
      ok: true,
      lineId,
      file: page.file,
      version,
      bytes,
      characters: page.spoken.length,
      credits,
      // No seed: one page is one file and one narrator, so there is nothing to hold steady
      // across the several NPCs a quests file can be shared by.
      seed: null,
      voice: config.voiceName,
      // narratorConfig resolves this or throws, so it is set by the time we are here.
      voiceId: config.voiceId!,
      dictionaryVersion: config.dictionaryVersionId ?? null,
      spokenText: page.spoken,
      sharedWith: 0,
    };
  } catch (error) {
    return { ok: false, failure: asFailure(error) };
  }
}
