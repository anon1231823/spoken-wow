/**
 * Narrating one line in a section read by the single narrator: zones and books.
 *
 * Both sections voice every line with the one narrator resolved from generation_setting and
 * the pronunciation lexicon, give every line a file of its own, and record a duration --
 * so everything from resolving that narrator to committing the take is the same, and was
 * written twice until a new take field (the lead-in) had to be added to both copies. What
 * stays in each section is what is actually about it: how a line is found and whether it
 * can be voiced at all.
 *
 * The result is a RegenerateResult rather than an exception because the worker decides
 * what to do next from `kind` and `fatal`: running out of credits fails every remaining
 * line identically and stops the batch, while one line that cannot be voiced is one line.
 *
 * THE REQUEST ITSELF IS lib/generation/tts.ts, the same client quests narrates through.
 */
import { BASE_LANG, elevenLabsCode } from "@/lib/lang";
import "server-only";

import { commitTake } from "@/lib/takes/commit";
import { durationOf } from "@/lib/zones/tools";
import { narratorConfig, NarratorMissing, type VoiceConfig } from "@/lib/zones/voice";

import { busy, failure } from "./errors";
import { BUSY, withTakeLock } from "./lock";
import type { RegenerateResult } from "./regenerate";
import { textToSpeech } from "./tts";
import type { Lang } from "@/lib/lang";

/** What a section hands over once it has found a line and decided it can be voiced. */
export type NarratedLine = {
  /** The id the caller asked for, echoed in the result. */
  lineId: string;
  file: string;
  /** The text as it will be spoken, after the pronunciation rules. */
  spoken: string;
  /** The section's hash of `spoken`, which staleness compares against. */
  hash: string;
};

/**
 * Resolving the narrator can fail before any request is made.
 *
 * Only this one kind: textToSpeech returns its own classified failure rather than
 * throwing, so there is nothing to recover from a message.
 */
function asFailure(error: unknown) {
  if (error instanceof NarratorMissing) return failure("voice-missing", error.message);
  return failure("upstream", error instanceof Error ? error.message : String(error));
}

export async function regenerateNarrated(
  source: "zones" | "books",
  line: NarratedLine,
  createdBy: string,
  options: { apiKey: string; lang?: Lang },
): Promise<RegenerateResult> {
  let config: VoiceConfig;
  try {
    config = await narratorConfig(options.apiKey, options.lang ?? BASE_LANG);
  } catch (error) {
    return { ok: false, failure: asFailure(error) };
  }

  // Held across the ElevenLabs call, not just the write: two requests for one line must not
  // both spend credits, and a restore must not interleave with the commit.
  const lang = options.lang ?? BASE_LANG;
  // The language's own lexicon, which narratorConfig read for it.
  const dictionary =
    config.dictionaryId && config.dictionaryVersionId
      ? { dictionaryId: config.dictionaryId, versionId: config.dictionaryVersionId }
      : null;

  const outcome = await withTakeLock(source, line.file, async (): Promise<RegenerateResult> => {
    // No seed: a line is narrated once and re-rolled by hand if it comes out wrong, so
    // there is nothing to reproduce bit for bit.
    const speech = await textToSpeech(
      {
        voiceId: config.voiceId!,
        text: line.spoken,
        modelId: config.modelId,
        voiceSettings: config.voiceSettings,
        seed: null,
        dictionary,
        languageCode: elevenLabsCode(lang),
      },
      { apiKey: options.apiKey },
    );
    if (!speech.ok) return { ok: false, failure: speech.failure };
    // Already trimmed of its lead-in by tts.ts: what is written here is what the addon plays.
    const { audio, credits } = speech;

    try {
      const committed = await commitTake(
        source,
        line.file,
        audio,
        {
          lineId: line.lineId,
          voiceId: config.voiceId ?? null,
          modelId: config.modelId,
          outputFormat: config.outputFormat,
          // Unlike an imported take, this one knows exactly what it was made with, so a
          // version that sounded right can be reproduced after the settings have moved on.
          settings: config.voiceSettings,
          characters: line.spoken.length,
          credits,
          spokenHash: line.hash,
          dictionaryId: dictionary?.dictionaryId ?? null,
          dictionaryVersion: dictionary?.versionId ?? null,
          leadIn: speech.leadIn,
          leadInSec: speech.leadInSec,
          createdBy,
        },
        { lang, measure: durationOf },
      );

      return {
        ok: true,
        lineId: line.lineId,
        file: line.file,
        version: committed.version,
        bytes: committed.bytes,
        characters: line.spoken.length,
        credits,
        // No seed. The quests side derives one per NPC so a file shared by several of them
        // regenerates the same way whichever row the button was pressed on; here every line
        // has a file of its own and one narrator, so there is nothing to hold steady.
        seed: null,
        voice: config.voiceName,
        // narratorConfig resolves this or throws, so it is set by the time we are here.
        voiceId: config.voiceId!,
        dictionaryVersion: dictionary?.versionId ?? null,
        spokenText: line.spoken,
        // Nothing else plays this file: every line has its own, which is the whole
        // difference from a quests gossip file named after its text.
        sharedWith: 0,
      };
    } catch (error) {
      return { ok: false, failure: asFailure(error) };
    }
  }, lang);

  return outcome === BUSY ? { ok: false, failure: busy(line.file) } : outcome;
}
