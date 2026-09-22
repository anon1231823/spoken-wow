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
 *
 * What gets spoken is the override if there is one and the corpus text otherwise, and that
 * choice is made before the refusals rather than after: whether a line can be voiced at all is
 * a property of the text that will be sent. The corpus's `generatable` flag cannot answer it,
 * having been computed in Python from text that nobody could edit yet.
 */
import { BASE_LANG, elevenLabsCode, type Lang } from "@/lib/lang";
import { audioRelPath } from "@/lib/audio";
import type { CorpusLine } from "@/lib/corpus";
import { lineIndex } from "@/lib/quests/catalogue";
import { readIgnores } from "@/lib/quests/ignores";
import { readOverrides } from "@/lib/quests/overrides";
import { commitTake } from "@/lib/takes/commit";
import { INVALID_CHARS, isVoiceable } from "@/lib/text-gate";

import { currentLocator } from "./dictionary";
import { fileDefaults } from "./files";
import { applyPronunciation } from "./pronunciation";
import { canonicalNpcId, seedFor } from "./seed";
import { spokenHash } from "./spoken-hash";
import { currentConfig } from "./settings";
import { generationStatus } from "./status";
import { accentTagged, audioTags, NARRATOR_VOICE, segments } from "./narration";
import { textToDialogue, textToSpeech } from "./tts";
import { BUSY, withTakeLock } from "./lock";
import { busy, failure, type Failure } from "./errors";
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
};

export type RegenerateResult = RegenerateSuccess | { ok: false; failure: Failure };

/**
 * Group the corpus lines that resolve to one lineId.
 *
 * A gossip lineId is g:{md5(text + race + gender)}, so it can name many NPCs at once - they
 * share the text, the voice and the mp3, and differ only in who says it.
 */
async function resolve(lineId: string, lang: Lang): Promise<CorpusLine[] | null> {
  const group = (await lineIndex(lang)).get(lineId);
  return group && group.length > 0 ? group : null;
}

/**
 * `options.lang` is the language to speak the line in: its text (lib/quests/catalogue.ts reads
 * a language over the English lines), its settings, its lexicon, and a take filed under it.
 * English when absent, which is every caller that predates languages.
 */
export async function regenerateLine(
  lineId: string,
  createdBy: string,
  options: ElevenLabsOptions & { lang?: Lang } = {},
): Promise<RegenerateResult> {
  const lang = options.lang ?? BASE_LANG;
  const english = lang === BASE_LANG;
  const group = await resolve(lineId, lang);
  if (!group) {
    return { ok: false, failure: { ...failure("bad-request", `no line ${lineId}`), status: 404 } };
  }

  const line = group[0];
  const file = audioRelPath(line);

  // Before the voiceability gate and before any credit is spent: an ignored line is a
  // decision, not a defect, so no override can rescue it and there is nothing to weigh up.
  // A queued job can outlive the decision, which is exactly why this is checked here rather
  // than only where the queue is filled.
  const ignore = (await readIgnores(lang)).get(lineId);
  if (ignore) {
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} is ignored: ${ignore.reason}`),
        status: 409,
        fatal: false,
      },
    };
  }

  // Read per line rather than hoisted over a batch, for the reason the dictionary locator is
  // read inside the lock below: someone rewriting a line mid-batch should affect the lines
  // after the save. Read *before* the gate because an override is what decides whether this
  // line is voiceable at all - the corpus's own flag was computed from text nobody could edit.
  //
  // English only: an override rewrites the English corpus. Another language's rewrites are
  // versions of its own text, which `line` already is.
  const overrides = english ? await readOverrides() : new Map();
  const source = overrides.get(file)?.text ?? line.text;

  if (!isVoiceable(line, source)) {
    const why =
      line.skipReason === "progress"
        ? "progress text is deliberately skipped"
        : line.skipReason === "untranslated"
          ? `it has no ${lang} text yet`
          : `its text still holds one of ${INVALID_CHARS} - rewrite it to voice it`;
    return {
      ok: false,
      failure: {
        ...failure("bad-request", `${lineId} is never voiced: ${why}`),
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

  const outcome = await withTakeLock("quests", file, async (): Promise<RegenerateResult> => {
    const config = await currentConfig(lang);
    // The accent direction goes on last, so it sits in front of the words rather than in
    // front of a `<hic>` audioTags has yet to rewrite. Inside spokenText and not bolted on at
    // the request, because these are characters ElevenLabs bills and the staleness check
    // hashes: a take that under-reported them would be mispriced and permanently stale.
    //
    // The committed pronunciation rules are English's spellings of English words; another
    // language is spoken with its own lexicon, through the dictionary below, and nothing else.
    const spokenText = accentTagged(
      audioTags(english ? applyPronunciation(source, fileDefaults().rules) : source),
      config.raceTags[line.race],
    );
    // Read inside the lock and per line, not hoisted: an admin saving the lexicon mid-batch
    // should affect the lines after the save, and pinning one locator for a whole batch
    // would record a version that some of those takes were not made with.
    const dictionary = await currentLocator(lang);
    const languageCode = elevenLabsCode(lang);
    // Lowest npcId in the group, so a file shared by many NPCs regenerates the same way
    // whichever row the button was pressed on. See canonicalNpcId.
    const seed = seedFor(canonicalNpcId(group), config.seedStrategy);

    // A capitalised <stage direction> is the game narrating, not the NPC talking, so the line
    // is spoken by two voices and ElevenLabs stitches the turns into one file. Everything
    // below - seed, dictionary, credit accounting - is identical either way.
    const parts = segments(spokenText);
    const narrated = parts.some((part) => part.speaker === "narrator");

    // Resolved by name from the account, because narrator-male is not a race-gender-flavor
    // slot and so has no corpus line to read it off.
    const narratorVoiceId = narrated ? status.voiceIds.get(NARRATOR_VOICE) : undefined;
    if (narrated && !narratorVoiceId) {
      return {
        ok: false,
        failure: failure(
          "voice-missing",
          `no ElevenLabs voice named "${NARRATOR_VOICE}". Create it on /voices before generating a line with stage directions.`,
        ),
      };
    }

    const speech = narrated
      ? await textToDialogue(
          {
            inputs: parts.map((part) => ({
              text: part.text,
              voiceId: part.speaker === "narrator" ? narratorVoiceId! : voiceId,
            })),
            modelId: config.modelId,
            stability: config.voiceSettings.stability,
            seed,
            dictionary,
            languageCode,
          },
          options,
        )
      : await textToSpeech(
          {
            voiceId,
            text: spokenText,
            modelId: config.modelId,
            voiceSettings: config.voiceSettings,
            seed,
            dictionary,
            languageCode,
          },
          options,
        );
    if (!speech.ok) return { ok: false, failure: speech.failure };

    // Already trimmed of its lead-in by tts.ts, so the archived file and `bytes` both
    // describe the audio the addon will play.
    const committed = await commitTake(
      "quests",
      file,
      speech.audio,
      {
        lineId,
        voice: line.voice,
        narratorVoice: narrated ? NARRATOR_VOICE : null,
        voiceId,
        modelId: config.modelId,
        seed,
        characters: spokenText.length,
        credits: speech.credits,
        // What was actually sent: the dialogue endpoint takes only stability, and a row
        // claiming the other three would describe a take that never had them.
        settings: narrated
          ? { stability: config.voiceSettings.stability }
          : config.voiceSettings,
        spokenHash: spokenHash(spokenText),
        dictionaryVersion: dictionary?.versionId ?? null,
        leadIn: speech.leadIn,
        leadInSec: speech.leadInSec,
        createdBy,
      },
      { lang },
    );

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
    };
  }, lang);

  if (outcome === BUSY) return { ok: false, failure: busy(file) };
  return outcome;
}
