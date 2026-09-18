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

import { classifyUpstream, failure } from "@/lib/generation/errors";
import type { RegenerateResult } from "@/lib/generation/regenerate";
import { synthesize, type VoiceConfig } from "@/lib/zones/tools";
import { narratorConfig, NarratorMissing } from "@/lib/zones/voice";

import { catalogue, BASE_LANG, type BookPage } from "./catalogue";
import { durationOf } from "./tools";
import { insertTake, writeAudio } from "./store";

/**
 * What the pipeline threw, as a failure the queue understands.
 *
 * synthesize() reports an HTTP failure as `ElevenLabs returned 429: {json}`, having already
 * retried the retryable ones, so the status is worth recovering from the message: it is the
 * difference between stopping a batch and moving to the next page.
 */
function asFailure(error: unknown) {
  if (error instanceof NarratorMissing) return failure("voice-missing", error.message);

  const message = error instanceof Error ? error.message : String(error);
  const match = /^ElevenLabs returned (\d{3}): ([\s\S]*)$/.exec(message);
  if (match) return classifyUpstream(Number(match[1]), match[2], "narrating this page");

  return failure("upstream", message);
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

  try {
    const { audio, credits } = await synthesize(page.spoken, config, options.apiKey);

    // Archives the take being replaced, which is what makes a bad re-roll reversible.
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
        voiceId: config.voiceId ?? null,
        modelId: config.modelId,
        outputFormat: config.outputFormat,
        dictionaryId: config.dictionaryId ?? null,
        dictionaryVersionId: config.dictionaryVersionId ?? null,
        generatedAt: new Date().toISOString(),
      },
      "generated",
      // Unlike an imported take this one knows what it was made with, so a version that
      // sounded right can be reproduced after the settings have moved on.
      config.voiceSettings,
      lang,
    );

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
      // A quests idea: there the app took over a store the Python CLI had filled. The
      // books store starts empty, so there is never inherited audio to archive on the way in.
      archivedInherited: false,
    };
  } catch (error) {
    return { ok: false, failure: asFailure(error) };
  }
}
