/**
 * Turning a line's text into an mp3.
 *
 * The TypeScript twin of synthesize_line in tts_cli/synthesize.py: same model, same
 * voice_settings object, same optional seed, and no output_format, so both sides take the
 * API's default. Audio produced here has to be near-indistinguishable from audio produced
 * there, because the addon resolves a sound by filename and cannot tell which made it.
 *
 * Two fields the Python side does not send, and both are deliberate: the pronunciation
 * dictionary, and language_code. The CLI predates the lexicon and infers language from the
 * text; this path pins both, so a line generated here is the more correct of the two. The
 * version row records the model and the dictionary version, which is what makes the
 * difference visible after the fact rather than a mystery.
 *
 * `fetch` and the base URL are injectable for the reason synthesize.py injects http_post:
 * no test should need an account, and none should ever spend money.
 */
import {
  DEFAULT_BASE_URL,
  type DictionaryLocator,
  type ElevenLabsOptions,
} from "@/lib/voices/elevenlabs";

import type { VoiceSettings } from "./config";
import { classifyUpstream, failure, type Failure } from "./errors";

/**
 * The corpus is English, so every request says so.
 *
 * ElevenLabs describes language_code as enforcing a language "for the model and text
 * normalization". Without it a multilingual model infers the language from the text, and a
 * short input gives it almost nothing to go on - a bare name in a preview gives it nothing at
 * all, which is how a word preview comes back with the wrong language's vowels. It also plausibly
 * governs how a phoneme string is read, since an IPA symbol means different things under
 * different phonologies.
 */
export const CORPUS_LANGUAGE = "en";

/**
 * Models that accept language_code. Others are sent none.
 *
 * A list rather than a guess, and it errs toward omitting: leaving the field off is exactly
 * today's behaviour, so a model missing from here loses nothing, while sending it to a model
 * that rejects it would fail a request that used to work. multilingual_v2 is documented as
 * not supporting it.
 */
export const LANGUAGE_MODELS = ["eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"] as const;

export function acceptsLanguage(modelId: string): boolean {
  return (LANGUAGE_MODELS as readonly string[]).includes(modelId);
}

export type SpeechRequest = {
  voiceId: string;
  /** Already normalised by applyPronunciation; this function does not touch it. */
  text: string;
  modelId: string;
  voiceSettings: VoiceSettings;
  seed: number | null;
  /**
   * The pronunciation dictionary to apply, or null for none.
   *
   * Null is the state the Python CLI is always in: synthesize.py sends no dictionary, so a
   * line it produces and a line produced here can differ in pronunciation even with
   * identical settings. That is the one place the two paths no longer match, and it is why
   * the locator is recorded against every take.
   */
  dictionary?: DictionaryLocator | null;
};

export type SpeechResult =
  | {
      ok: true;
      audio: Buffer;
      /**
       * What the request actually cost, from the `character-cost` response header.
       *
       * Not the length of the text. ElevenLabs bills round(characters x rate), and the rate
       * is a property of the plan rather than the request: measured at 0.55 on this account
       * for the standard models and half that for flash and turbo, so 310 characters cost
       * 170. Reading the header is the only way to know without guessing at someone's plan,
       * and it agreed with the usage-stats delta on every model and length tried.
       *
       * null when the header is absent, which is a reason to stop reporting a number rather
       * than to invent one.
       */
      credits: number | null;
    }
  | { ok: false; failure: Failure };

/** The exact cost of a request, or null if ElevenLabs did not say. */
export function creditsFrom(headers: Headers): number | null {
  const raw = headers.get("character-cost");
  if (raw === null) return null;
  const credits = Number(raw);
  return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

export function buildPayload(request: SpeechRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: request.text,
    model_id: request.modelId,
    voice_settings: request.voiceSettings,
  };
  // Omitted rather than sent as null when the strategy is "none": Python omits the key, and
  // a null seed is a value ElevenLabs would have to interpret.
  if (request.seed !== null) payload.seed = request.seed;
  // Not recorded on the version row, unlike the model and the settings, because it is a
  // constant derived from the model - which IS recorded. Given a take's modelId you can say
  // whether it carried a language, so long as this stays a constant. If it ever becomes a
  // setting, it needs a column.
  if (acceptsLanguage(request.modelId)) payload.language_code = CORPUS_LANGUAGE;
  // Same reasoning for the dictionary, and the version id is not optional: naming the
  // dictionary without a version would let a later upload change how an already-recorded
  // take would sound, which is the thing dictionaryVersion exists to pin down.
  if (request.dictionary) {
    payload.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: request.dictionary.dictionaryId,
        version_id: request.dictionary.versionId,
      },
    ];
  }
  return payload;
}

export async function textToSpeech(
  request: SpeechRequest,
  options: ElevenLabsOptions = {},
): Promise<SpeechResult> {
  const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, failure: failure("auth", "ELEVENLABS_API_KEY is not set") };

  const baseUrl = options.baseUrl ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/v1/text-to-speech/${request.voiceId}`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(request)),
    });
  } catch (error) {
    // DNS, TLS, a dropped connection: not a batch-stopping condition, because the next line
    // may well succeed.
    return {
      ok: false,
      failure: failure("upstream", `could not reach ElevenLabs: ${message(error)}`),
    };
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    return { ok: false, failure: classifyUpstream(response.status, raw, "generating the line") };
  }

  // The same check synthesize.py makes, and it earns its place: an error served with a 200
  // would otherwise be written into the store as an mp3 and play as silence in the game.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) {
    const raw = await response.text().catch(() => "");
    return {
      ok: false,
      failure: failure(
        "upstream",
        `ElevenLabs answered 200 with ${contentType || "no content type"} rather than audio: ${raw.slice(0, 200)}`,
      ),
    };
  }

  const credits = creditsFrom(response.headers);
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    return { ok: false, failure: failure("upstream", "ElevenLabs returned an empty response") };
  }

  return { ok: true, audio, credits };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
