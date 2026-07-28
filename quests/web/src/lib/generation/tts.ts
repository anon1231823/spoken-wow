/**
 * Turning a line's text into an mp3.
 *
 * The TypeScript twin of synthesize_line in tts_cli/synthesize.py, and the payload is
 * deliberately identical to build_payload's: same model, same voice_settings object, same
 * optional seed, and no output_format, so both sides take the API's default. Audio produced
 * here has to be indistinguishable from audio produced there, because the addon resolves a
 * sound by filename and cannot tell which made it.
 *
 * `fetch` and the base URL are injectable for the reason synthesize.py injects http_post:
 * no test should need an account, and none should ever spend money.
 */
import { DEFAULT_BASE_URL, type ElevenLabsOptions } from "@/lib/voices/elevenlabs";

import type { VoiceSettings } from "./config";
import { classifyUpstream, failure, type Failure } from "./errors";

export type SpeechRequest = {
  voiceId: string;
  /** Already normalised by applyPronunciation; this function does not touch it. */
  text: string;
  modelId: string;
  voiceSettings: VoiceSettings;
  seed: number | null;
};

export type SpeechResult = { ok: true; audio: Buffer } | { ok: false; failure: Failure };

export function buildPayload(request: SpeechRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: request.text,
    model_id: request.modelId,
    voice_settings: request.voiceSettings,
  };
  // Omitted rather than sent as null when the strategy is "none": Python omits the key, and
  // a null seed is a value ElevenLabs would have to interpret.
  if (request.seed !== null) payload.seed = request.seed;
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

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    return { ok: false, failure: failure("upstream", "ElevenLabs returned an empty response") };
  }

  return { ok: true, audio };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
