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

/**
 * What the plan allows and how much of it is left.
 *
 * The character budget is the reason this exists: Creator is 131,000 characters a month, and
 * one talkative NPC is a visible fraction of that. Regenerating a whole NPC without seeing
 * the balance first is how a month's budget disappears in one click.
 */
export type Subscription = {
  tier: string;
  characterCount: number;
  characterLimit: number;
  /** When the character count resets, ISO, or null if the account reports no reset. */
  resetAt: string | null;
  voiceSlotsUsed: number;
  voiceLimit: number;
};

export async function getSubscription(options: ElevenLabsOptions = {}): Promise<Subscription> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/user/subscription`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "reading the ElevenLabs subscription");

  const body = (await response.json()) as Record<string, unknown>;
  const number = (key: string) => (typeof body[key] === "number" ? (body[key] as number) : 0);
  const reset = body.next_character_count_reset_unix;

  return {
    tier: typeof body.tier === "string" ? body.tier : "unknown",
    characterCount: number("character_count"),
    characterLimit: number("character_limit"),
    resetAt: typeof reset === "number" ? new Date(reset * 1000).toISOString() : null,
    voiceSlotsUsed: number("voice_slots_used"),
    voiceLimit: number("voice_limit"),
  };
}

/**
 * A model the account may generate with.
 *
 * Read from the account rather than listed in the code. Hardcoding the list meant the
 * settings page silently withheld a model ElevenLabs had already made available - the
 * options should be whatever the plan actually allows, not whatever was true when this was
 * written.
 */
export type Model = {
  id: string;
  name: string;
  description: string;
  /** Longest single request the model accepts, which bounds a line rather than a batch. */
  maxCharacters: number | null;
  languages: number;
};

export async function listModels(options: ElevenLabsOptions = {}): Promise<Model[]> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/models`, {
    headers: { "xi-api-key": apiKey },
    cache: "no-store",
  });
  if (!response.ok) throw await failure(response, "listing ElevenLabs models");

  const body = (await response.json()) as unknown;
  if (!Array.isArray(body)) return [];

  return body
    .filter(
      (model): model is Record<string, unknown> =>
        Boolean(model) &&
        typeof model === "object" &&
        // Speech-to-speech and sound-effect models share this endpoint and cannot voice a
        // line, so offering them would be offering a guaranteed failure.
        (model as Record<string, unknown>).can_do_text_to_speech === true &&
        typeof (model as Record<string, unknown>).model_id === "string",
    )
    .map((model) => ({
      id: model.model_id as string,
      name: typeof model.name === "string" ? model.name : (model.model_id as string),
      description: typeof model.description === "string" ? model.description : "",
      maxCharacters:
        typeof model.maximum_text_length_per_request === "number"
          ? model.maximum_text_length_per_request
          : null,
      languages: Array.isArray(model.languages) ? model.languages.length : 0,
    }));
}

export type Clip = { name: string; data: Buffer };

/**
 * Create an instant voice clone.
 *
 * Background noise removal is always on: the clips are extracted game audio, which carries
 * music beds and ambience, and similarity_boost at synthesis time reproduces whatever is in
 * the source — including the tavern behind the innkeeper.
 */
export async function addVoice(
  name: string,
  clips: Clip[],
  options: ElevenLabsOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const form = new FormData();
  form.append("name", name);
  form.append("remove_background_noise", "true");
  for (const clip of clips) {
    form.append("files", new Blob([new Uint8Array(clip.data)]), clip.name);
  }

  // No Content-Type header: fetch sets it, with the multipart boundary, which cannot be
  // written by hand.
  const response = await fetchImpl(`${baseUrl}/v1/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
  });
  if (!response.ok) throw await failure(response, `creating the voice "${name}"`);

  const body = (await response.json()) as { voice_id?: string };
  if (!body.voice_id) throw new Error(`ElevenLabs created "${name}" but returned no voice_id`);
  return body.voice_id;
}

/** Where a set of rules ended up: the pair a TTS request has to name to use them. */
export type DictionaryLocator = { dictionaryId: string; versionId: string };

/**
 * Upload a set of pronunciation rules and get back the locator for them.
 *
 * A fresh dictionary every time, rather than adding and removing rules on the existing one.
 * The alternative is to diff the saved lexicon against the uploaded one and issue add-rules
 * and remove-rules for the difference, which is more requests, more code, and a new way to
 * be wrong - a diff that misses a removal leaves a rule in force that nobody can see on the
 * editor page. Creating one dictionary per save costs an unused dictionary on the account
 * per edit, which is the cheaper of the two mistakes.
 *
 * The rules are phoneme rules, and phoneme rules are honoured by eleven_v3 and
 * eleven_flash_v2 only. This function does not check the model: the dictionary is worth
 * uploading regardless, and the model can change afterwards without re-uploading.
 */
export async function createPronunciationDictionary(
  name: string,
  rules: unknown[],
  options: ElevenLabsOptions = {},
): Promise<DictionaryLocator> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/pronunciation-dictionaries/add-from-rules`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ name, rules }),
  });
  if (!response.ok) throw await failure(response, "uploading the pronunciation dictionary");

  const body = (await response.json()) as { id?: string; version_id?: string };
  if (!body.id || !body.version_id) {
    throw new Error("ElevenLabs accepted the dictionary but returned no id and version");
  }
  return { dictionaryId: body.id, versionId: body.version_id };
}

/**
 * Read a dictionary back, as the PLS ElevenLabs stores it.
 *
 * The only way to find out what it actually kept. add-from-rules answers 200 with an id and a
 * version whether it accepted every rule or silently dropped most of them, so counting the
 * lexemes here is the difference between an upload that worked and one that appeared to.
 */
export async function downloadPronunciationDictionary(
  locator: DictionaryLocator,
  options: ElevenLabsOptions = {},
): Promise<string> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(
    `${baseUrl}/v1/pronunciation-dictionaries/${locator.dictionaryId}/${locator.versionId}/download`,
    { headers: { "xi-api-key": apiKey }, cache: "no-store" },
  );
  if (!response.ok) throw await failure(response, "reading the pronunciation dictionary back");
  return response.text();
}

/** How many rules a stored dictionary holds. One lexeme per rule. */
export function countLexemes(pls: string): number {
  return (pls.match(/<lexeme\b/g) ?? []).length;
}

export async function deleteVoice(
  voiceId: string,
  options: ElevenLabsOptions = {},
): Promise<void> {
  const { apiKey, baseUrl, fetchImpl } = config(options);

  const response = await fetchImpl(`${baseUrl}/v1/voices/${voiceId}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) throw await failure(response, `deleting voice ${voiceId}`);
}
