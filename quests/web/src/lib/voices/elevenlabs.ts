/**
 * Talking to ElevenLabs about voices.
 *
 * listVoices is the TypeScript twin of fetch_voice_map in tts_cli/voices.py, and the two
 * must agree: the Python pipeline resolves a voice by name at synthesis time, so a voice
 * this app creates is only usable if that function finds it. The name filter is the whole
 * contract, which is why it lives in one place on each side and is tested against the same
 * expectations.
 *
 * `fetch` and the base URL are both injectable, for the reason synthesize.py injects
 * http_post: no test should need an ElevenLabs account, and none should ever spend money.
 */
import { isVoiceSlot } from "./slots";

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";

export type Fetch = typeof globalThis.fetch;

export type ElevenLabsOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: Fetch;
};

function config(options: ElevenLabsOptions = {}) {
  const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  return {
    apiKey,
    baseUrl: options.baseUrl ?? process.env.ELEVENLABS_BASE_URL ?? DEFAULT_BASE_URL,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
  };
}

/**
 * ElevenLabs reports failures as JSON with a `detail` field, and the text is the only clue
 * to what went wrong — a plan without cloning, a duplicate name, an unusable sample. Losing
 * it behind a generic message would make every failure a support ticket.
 */
async function failure(response: Response, what: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  return new Error(`${what} failed (${response.status}): ${body.slice(0, 300)}`);
}

/** Voices in the account that this project can use, as `race-gender` -> voice id. */
export async function listVoices(options: ElevenLabsOptions = {}): Promise<Map<string, string>> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/voices`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "listing ElevenLabs voices");

  const body = (await response.json()) as { voices?: { name?: string; voice_id?: string }[] };

  const found = new Map<string, string>();
  for (const voice of body.voices ?? []) {
    // Stock voices are skipped rather than reported: their names ("Roger - Laid-Back,
    // Casual, Resonant") cannot express a race-gender mapping, so they are not candidates.
    if (!voice.name || !voice.voice_id) continue;
    if (isVoiceSlot(voice.name)) found.set(voice.name, voice.voice_id);
  }
  return found;
}
