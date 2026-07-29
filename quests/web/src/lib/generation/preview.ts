/**
 * Hearing one lexicon entry before it costs a batch.
 *
 * The trick that makes this possible without uploading anything: ElevenLabs accepts a
 * phoneme tag inline in the text, honoured by the same models that honour a dictionary
 * phoneme rule. So a draft entry can be spoken while it is still a draft - before it is
 * saved, before a dictionary exists, and without disturbing the one generation is using.
 *
 * What it does NOT prove is worth being clear about, because it is the more common
 * misunderstanding: this renders the SOUND, by substituting it directly. It says nothing
 * about whether the rule would fire - whether matching is really case-insensitive, whether
 * "Azshara's" inherits the rule for "Azshara". Only a request carrying the real dictionary
 * answers that, and this is not one.
 *
 * Cached on disk, keyed by everything that changes the audio. Re-opening an entry, or two
 * admins checking the same name, must not spend credits twice for identical bytes.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { loadCorpus, type CorpusLine } from "@/lib/corpus";
import { PREVIEW_DIR } from "@/lib/paths";
import type { ElevenLabsOptions } from "@/lib/voices/elevenlabs";

import type { GenerationConfig } from "./config";
import { honoursPhonemes, kindOf, type LexiconEntry } from "./lexicon";
import { failure, type Failure } from "./errors";
import { textToSpeech } from "./tts";

/**
 * The longest a preview may be.
 *
 * Credits are the reason. A preview exists to check one word, and the corpus contains quest
 * text that runs to a couple of thousand characters - rendering one of those to hear how a
 * name is said would cost more than regenerating the line it came from.
 */
export const MAX_PREVIEW_CHARS = 220;

/** A carrier for names the corpus happens not to use in any short sentence. */
export function carrier(grapheme: string): string {
  // A sentence rather than the bare word: a name in isolation gets list intonation and a
  // final fall, which is not how it will be said in a line, and prosody is half of what
  // someone is listening for when they check a pronunciation.
  return `They say ${grapheme} is not what it once was.`;
}

/** Split into sentences, keeping the terminator so the preview is a whole utterance. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The shortest real sentence in the corpus that uses this name, or a carrier if none does.
 *
 * A real line beats an invented one: it is the actual context, the actual register, and
 * hearing the name where it will really appear is the whole question. Shortest, because
 * every character is billed and a longer sentence tells you nothing more about one word.
 */
export function sampleSentence(grapheme: string, lines: CorpusLine[]): {
  text: string;
  line: CorpusLine | null;
} {
  // Case-insensitive and word-bounded, matching how the rule itself will match. Escaped,
  // because a grapheme is user input and "C'Thun" contains no metacharacters but the next
  // one added might.
  const escaped = grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "i");

  let best: { text: string; line: CorpusLine } | null = null;
  for (const line of lines) {
    if (!line.generatable || !pattern.test(line.text)) continue;
    for (const sentence of sentences(line.text)) {
      if (sentence.length > MAX_PREVIEW_CHARS || !pattern.test(sentence)) continue;
      if (!best || sentence.length < best.text.length) best = { text: sentence, line };
    }
  }

  return best ?? { text: carrier(grapheme), line: null };
}

/**
 * Put the entry's pronunciation into the sentence.
 *
 * An alias is substituted outright, which is exactly what an alias rule does. IPA is wrapped
 * in a phoneme tag, which is what the dictionary does by another route. Only the first
 * occurrence is touched: one is enough to hear, and every extra tag is billed.
 */
export function speakable(entry: LexiconEntry, sentence: string): string {
  const escaped = entry.grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "i");

  return sentence.replace(pattern, (matched) =>
    kindOf(entry) === "alias"
      ? entry.alias!
      : `<phoneme alphabet="ipa" ph="${entry.ipa!.replace(/"/g, "")}">${matched}</phoneme>`,
  );
}

/**
 * Everything that changes the bytes, and nothing that does not.
 *
 * The spoken text rather than the entry, so an IPA edit and an alias edit that happen to
 * produce the same request share a cached file. The voice and the settings are in it because
 * the same phonemes in a different voice are a different preview; `say`, the note, the
 * confidence and the category are not, because none of them reach ElevenLabs.
 */
export function previewKey(input: {
  text: string;
  voiceId: string;
  config: GenerationConfig;
}): string {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        text: input.text,
        voiceId: input.voiceId,
        modelId: input.config.modelId,
        settings: input.config.voiceSettings,
      }),
    )
    .digest("hex");
}

export function previewPath(key: string, dir: string = PREVIEW_DIR): string {
  return path.join(dir, `${key}.mp3`);
}

export type Preview = {
  audio: Buffer;
  /** What was sent, tag and all, so the page can show why it sounds the way it does. */
  spoken: string;
  /** The sentence before the pronunciation was substituted in. */
  sentence: string;
  /** The NPC the sentence came from, or null when it is the invented carrier. */
  source: { npcName: string; lineId: string } | null;
  /** False when this cost credits, true when it came off disk. */
  cached: boolean;
  characters: number;
  credits: number | null;
};

export type PreviewResult = { ok: true; preview: Preview } | { ok: false; failure: Failure };

/**
 * Render one entry, or read back the render from last time.
 *
 * No lock, unlike a regeneration. Two admins previewing the same entry at once may both pay
 * for it and write the same bytes over each other, which is a wasted request rather than a
 * corrupted file - and the alternative, a lock on a cache, would be more machinery than the
 * mistake is worth.
 */
export async function renderPreview(
  entry: LexiconEntry,
  /**
   * Which voice to speak with, given the line the sample came from.
   *
   * A function rather than an id, so the sample can be chosen once. The caller wants the
   * NPC's own voice where the account has it - hearing the name in the voice that will
   * actually say it is the point - and scanning the corpus twice to find that out would cost
   * 17,507 lines of matching per preview.
   */
  pickVoice: (line: CorpusLine | null) => string | null,
  config: GenerationConfig,
  options: ElevenLabsOptions = {},
  dir: string = PREVIEW_DIR,
): Promise<PreviewResult> {
  // Refused rather than rendered. An inline phoneme tag is honoured by exactly the models a
  // dictionary phoneme rule is, so on any other model this would come back sounding like the
  // default pronunciation - and someone checking their IPA would conclude they had written
  // it wrong, and "fix" a transcription that was right. A respelling has no such problem: it
  // is plain text, and every model reads it.
  if (kindOf(entry) === "ipa" && !honoursPhonemes(config.modelId)) {
    return { ok: false, failure: MODEL_IGNORES_PHONEMES(config.modelId) };
  }

  const { text: sentence, line } = sampleSentence(entry.grapheme, loadCorpus().lines);
  const spoken = speakable(entry, sentence);
  const source = line ? { npcName: line.npcName, lineId: line.lineId } : null;

  const voiceId = pickVoice(line);
  if (!voiceId) return { ok: false, failure: NO_VOICE };

  const key = previewKey({ text: spoken, voiceId, config });
  const file = previewPath(key, dir);

  if (fs.existsSync(file)) {
    return {
      ok: true,
      preview: {
        audio: fs.readFileSync(file),
        spoken,
        sentence,
        source,
        cached: true,
        characters: spoken.length,
        // Unknown rather than zero: this take cost whatever it cost when it was first made,
        // and reporting 0 would quietly understate what the page has spent.
        credits: null,
      },
    };
  }

  const speech = await textToSpeech(
    {
      voiceId,
      text: spoken,
      modelId: config.modelId,
      voiceSettings: config.voiceSettings,
      // No seed. A preview is a question about phonemes, and pinning it to an NPC's draw
      // would tie the answer to whichever NPC happened to say the sample sentence.
      seed: null,
    },
    options,
  );
  if (!speech.ok) return { ok: false, failure: speech.failure };

  // Written after the request succeeded, so a failure never leaves a truncated mp3 that the
  // next preview would serve from cache as though it were real audio.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, speech.audio);

  return {
    ok: true,
    preview: {
      audio: speech.audio,
      spoken,
      sentence,
      source,
      cached: false,
      characters: spoken.length,
      credits: speech.credits,
    },
  };
}

/** Reported when the configured model would silently ignore the tag this preview relies on. */
export const MODEL_IGNORES_PHONEMES = (modelId: string): Failure => ({
  ...failure(
    "bad-request",
    `${modelId} ignores phoneme rules, so a preview of this entry would play the default ` +
      `pronunciation rather than the IPA. Switch the model on /voices, or give this entry a ` +
      `respelling instead.`,
  ),
  status: 409,
});

/** Reported when the account has no voice to speak with. */
export const NO_VOICE = failure(
  "voice-missing",
  "no ElevenLabs voice exists yet, so there is nothing to preview with. Create one on /voices.",
);

/**
 * The NPC's own voice where the account has it, otherwise any voice at all.
 *
 * Falling back rather than refusing: a preview is about phonemes, and hearing them in the
 * wrong voice is far more useful than a page that cannot preview anything until all 20
 * voices exist.
 */
export function voicePicker(voiceIds: Map<string, string>) {
  return (line: CorpusLine | null): string | null =>
    (line && voiceIds.get(line.voice)) ?? voiceIds.values().next().value ?? null;
}
