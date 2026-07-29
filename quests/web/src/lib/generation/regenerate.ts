/**
 * Regenerating one line, end to end.
 *
 * Everything the route does apart from authentication, kept out of the route so it can be
 * read in one piece: resolve the line, refuse the cases that cannot work, take the lock,
 * spend the characters, commit the take.
 *
 * The order of the refusals matters. Each one avoids spending money on a request that was
 * always going to fail, and the cheapest checks come first - a line that is never voiced, or
 * a voice that does not exist, costs nothing to detect and would otherwise cost a request.
 */
import { audioRelPath } from "@/lib/audio";
import { lineIndex, type CorpusLine } from "@/lib/corpus";

import { currentLocator } from "./dictionary";
import { fileDefaults } from "./files";
import { applyPronunciation } from "./pronunciation";
import { canonicalNpcId, seedFor } from "./seed";
import { commitVersion } from "./history";
import { currentConfig } from "./settings";
import { generationStatus } from "./status";
import { textToSpeech } from "./tts";
import { BUSY, withFileLock } from "./lock";
import { failure, type Failure } from "./errors";
import type { ElevenLabsOptions } from "@/lib/voices/elevenlabs";

export type RegenerateSuccess = {
  ok: true;
  lineId: string;
  file: string;
  version: number;
  bytes: number;
  characters: number;
  /** What this cost, exactly, from ElevenLabs. null when it did not say. */
  credits: number | null;
  seed: number | null;
  voice: string;
  voiceId: string;
  /** Text actually spoken, after the pronunciation rules. Shown when it differs. */
  spokenText: string;
  /** The lexicon version applied, or null when no dictionary was in force. */
  dictionaryVersion: string | null;
  /** Other NPCs whose lines resolve to this same file, and who therefore also changed. */
  sharedWith: number;
  archivedInherited: boolean;
};

export type RegenerateResult = RegenerateSuccess | { ok: false; failure: Failure };

/**
 * Group the corpus lines that resolve to one lineId.
 *
 * A gossip lineId is g:{md5(text + race + gender)}, so it can name many NPCs at once - they
 * share the text, the voice and the mp3, and differ only in who says it.
 */
function resolve(lineId: string): CorpusLine[] | null {
  const group = lineIndex().get(lineId);
  return group && group.length > 0 ? group : null;
}

export async function regenerateLine(
  lineId: string,
  createdBy: string,
  options: ElevenLabsOptions = {},
): Promise<RegenerateResult> {
  const group = resolve(lineId);
  if (!group) {
    return { ok: false, failure: { ...failure("bad-request", `no line ${lineId}`), status: 404 } };
  }

  const line = group[0];
  if (!line.generatable) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} is never voiced (${line.skipReason})`),
        status: 409,
        // Not a transient condition, but not a reason to abandon a batch either: the other
        // lines are fine. The client filters these out before starting, so reaching here
        // means the corpus moved under an open page.
        fatal: false,
      },
    };
  }

  // The account, not the provenance table: a voice created in the ElevenLabs dashboard is
  // just as real to tts_cli/voices.py, and refusing to notice it would block a usable voice.
  const status = await generationStatus(options);
  if (status.error && status.voiceIds.size === 0) {
    return { ok: false, failure: failure("auth", status.error) };
  }

  const voiceId = status.voiceIds.get(line.voice);
  if (!voiceId) {
    return {
      ok: false,
      failure: failure(
        "voice-missing",
        `no ElevenLabs voice named "${line.voice}". Create it on /voices before generating this line.`,
      ),
    };
  }

  const file = audioRelPath(line);

  const outcome = await withFileLock(file, async (): Promise<RegenerateResult> => {
    const config = await currentConfig();
    const spokenText = applyPronunciation(line.text, fileDefaults().rules);
    // Read inside the lock and per line, not hoisted: an admin saving the lexicon mid-batch
    // should affect the lines after the save, and pinning one locator for a whole batch
    // would record a version that some of those takes were not made with.
    const dictionary = await currentLocator();
    // Lowest npcId in the group, so a file shared by many NPCs regenerates the same way
    // whichever row the button was pressed on. See canonicalNpcId.
    const seed = seedFor(canonicalNpcId(group), config.seedStrategy);

    const speech = await textToSpeech(
      {
        voiceId,
        text: spokenText,
        modelId: config.modelId,
        voiceSettings: config.voiceSettings,
        seed,
        dictionary,
      },
      options,
    );
    if (!speech.ok) return { ok: false, failure: speech.failure };

    const committed = await commitVersion({
      file,
      data: speech.audio,
      lineId,
      voice: line.voice,
      voiceId,
      modelId: config.modelId,
      seed,
      characters: spokenText.length,
      credits: speech.credits,
      settings: config.voiceSettings,
      spokenText,
      dictionaryVersion: dictionary?.versionId ?? null,
      createdBy,
    });

    return {
      ok: true,
      lineId,
      file,
      version: committed.version,
      bytes: committed.bytes,
      characters: spokenText.length,
      credits: speech.credits,
      seed,
      voice: line.voice,
      voiceId,
      spokenText,
      dictionaryVersion: dictionary?.versionId ?? null,
      sharedWith: new Set(group.map((l) => `${l.npcType}:${l.npcId}`)).size - 1,
      archivedInherited: committed.archivedInherited,
    };
  });

  if (outcome === BUSY) {
    return {
      ok: false,
      failure: {
        ...failure("upstream", `${file} is already being regenerated; try again in a moment`),
        status: 409,
        fatal: false,
      },
    };
  }
  return outcome;
}
