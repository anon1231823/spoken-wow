// The only module here that talks to the network.
//
// Kept separate so the selection and dry-run paths -- everything that costs
// nothing -- can be exercised without an API key.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BASE_LOCALE } from "../lib/locales.mjs";
import { ROOT } from "../lib/loredata.mjs";
import { requireEnvKey } from "../lib/env.mjs";

const VOICES_URL = "https://api.elevenlabs.io/v1/voices";
const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export const CONFIG_PATH = join(ROOT, "tools/voice/config.json");

// A language's overrides, merged over config.json. Everything the switcher has to
// switch at generation time lives in one file per language -- voice, model,
// language_code, pronunciation dictionary -- because they only make sense
// together: a German voice reading through an English phoneme dictionary is worse
// than either half alone.
//
// No such file exists yet. English is config.json, and a language gets one when
// somebody has decided which voice reads it -- which is a decision, not a default
// this module can invent.
export function localeConfigPath(lang) {
  return join(ROOT, "tools/voice", `config.${lang}.json`);
}

//------------------------------------------------------------------------------
// Credentials
//------------------------------------------------------------------------------

export async function apiKey() {
  return requireEnvKey("ELEVENLABS_API_KEY", "sk_...");
}

//------------------------------------------------------------------------------
// Config
//------------------------------------------------------------------------------

export async function loadConfig(lang = BASE_LOCALE) {
  const base = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
  if (lang === BASE_LOCALE) return base;

  const overrides = await readFile(localeConfigPath(lang), "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (overrides === null) {
    throw new Error(
      `no voice configured for ${lang}: write tools/voice/config.${lang}.json first.\n` +
        `Generating it with the English narrator would spend credits on the wrong voice.`,
    );
  }

  // A shallow merge, and voiceSettings is replaced rather than merged: half the
  // English settings under a different voice is not a configuration anyone chose.
  return { ...base, ...JSON.parse(overrides) };
}

export async function saveConfig(config) {
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

//------------------------------------------------------------------------------
// Voice lookup
//------------------------------------------------------------------------------

// Resolves voiceName -> voiceId once and caches it into config.json. Pinning the
// id matters: renaming the voice on the account would otherwise silently start
// producing a different narrator halfway through a corpus.
export async function listVoices(key) {
  const response = await fetch(VOICES_URL, { headers: { "xi-api-key": key } });
  if (!response.ok) {
    throw new Error(
      `could not list voices (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }
  const { voices } = await response.json();
  return voices;
}

export async function resolveVoiceId(config, key) {
  if (config.voiceId) return config.voiceId;

  const voices = await listVoices(key);
  const match = voices.find((v) => v.name === config.voiceName);
  if (!match) {
    const names = voices.map((v) => v.name).sort().join(", ");
    throw new Error(
      `no voice named "${config.voiceName}" on this account.\nAvailable: ${names}`,
    );
  }

  config.voiceId = match.voice_id;
  await saveConfig(config);
  return config.voiceId;
}

//------------------------------------------------------------------------------
// Synthesis
//------------------------------------------------------------------------------

// Models that accept language_code. A list rather than a guess, and it errs
// toward omitting: leaving the field off is the older behaviour and loses
// nothing, while sending it to a model that rejects it fails the whole request.
const LANGUAGE_MODELS = new Set(["eleven_v3", "eleven_flash_v2_5", "eleven_turbo_v2_5"]);

export function buildPayload(spokenText, config) {
  const payload = {
    text: spokenText,
    model_id: config.modelId,
    voice_settings: config.voiceSettings,
  };

  if (config.languageCode && LANGUAGE_MODELS.has(config.modelId)) {
    payload.language_code = config.languageCode;
  }

  // Both halves or neither. The version is not optional: naming a dictionary
  // without one lets a later upload change how already-generated lines would
  // sound, which is the thing the manifest exists to make knowable after the fact.
  if (config.dictionaryId && config.dictionaryVersionId) {
    payload.pronunciation_dictionary_locators = [
      {
        pronunciation_dictionary_id: config.dictionaryId,
        version_id: config.dictionaryVersionId,
      },
    ];
  }

  return payload;
}

//------------------------------------------------------------------------------
// Pronunciation dictionary
//------------------------------------------------------------------------------

// Resolves the dictionary id to its CURRENT latest version, in memory, for this
// run. Deliberately not written back to config.json: the lexicon lives in
// ../wow-voiceover and this project always wants its newest version, so a pin
// would only go stale. Within one run the version stays fixed -- resolved once,
// used for every request -- and each take records the version it was made with,
// which is what keeps drift knowable per line after the fact.
export async function resolveDictionary(config, key) {
  if (!config.dictionaryId || config.dictionaryVersionId) return;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/pronunciation-dictionaries/${config.dictionaryId}`,
    { headers: { "xi-api-key": key } },
  );
  if (!response.ok) {
    throw new Error(
      `could not read pronunciation dictionary ${config.dictionaryId} ` +
        `(${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const body = await response.json();
  const version = body.latest_version_id ?? body.version_id;
  if (!version) {
    throw new Error(
      `pronunciation dictionary ${config.dictionaryId} returned no version id; ` +
        `fields were: ${Object.keys(body).join(", ")}`,
    );
  }

  config.dictionaryVersionId = version;
}

// The resolved dictionary as ElevenLabs stores it: a PLS document, one lexeme per
// rule. This is the only way to see what the shared lexicon actually contains --
// it is edited in ../wow-voiceover, and nothing about it lives in this repo
// beyond the id.
export async function downloadDictionary(config, key) {
  const response = await fetch(
    "https://api.elevenlabs.io/v1/pronunciation-dictionaries/" +
      `${config.dictionaryId}/${config.dictionaryVersionId}/download`,
    { headers: { "xi-api-key": key } },
  );
  if (!response.ok) {
    throw new Error(
      `could not download pronunciation dictionary ${config.dictionaryId} ` +
        `(${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }
  return response.text();
}

//------------------------------------------------------------------------------
// Account
//------------------------------------------------------------------------------

// The plan tier, which is what sets the concurrency limit. Null rather than a
// throw if it cannot be read: an unknown tier falls back to the smallest budget,
// so a failure here costs speed rather than the run.
export async function fetchTier(key) {
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
    });
    if (!response.ok) return null;
    const body = await response.json();
    return body.tier ?? null;
  } catch {
    return null;
  }
}

// Is this key real, and whose plan is it? Used by the explorer before it stores a
// key someone has pasted, so a typo fails at the profile page rather than 401ing in
// the middle of a batch -- where isFatal() correctly abandons the remaining work, and
// a bad paste therefore costs a whole run.
//
// Throws where fetchTier returns null: this is a question about the key itself, and
// "could not tell" is the wrong thing to store as "verified".
export async function verifyKey(key) {
  const response = await fetch("https://api.elevenlabs.io/v1/user", {
    headers: { "xi-api-key": key },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("ElevenLabs rejected this key.");
  }
  if (!response.ok) {
    throw new Error(
      `could not verify the key (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const body = await response.json();
  return { tier: body.subscription?.tier ?? null };
}

// What ElevenLabs actually charged, or null if it did not say. The rate belongs
// to the plan rather than the request, so this is the only way to know a real
// cost without guessing at someone's subscription.
export function creditsFrom(headers) {
  const raw = headers.get("character-cost");
  if (raw === null) return null;
  const credits = Number(raw);
  return Number.isFinite(credits) && credits >= 0 ? credits : null;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

// `onRateLimit` lets the caller shrink its concurrency the moment a 429 appears,
// rather than each worker independently backing off and then all charging back in
// together.
export async function synthesize(spokenText, config, key, { attempts = 4, onRateLimit } = {}) {
  const url = `${TTS_URL}/${config.voiceId}?output_format=${encodeURIComponent(config.outputFormat)}`;
  const body = JSON.stringify(buildPayload(spokenText, config));

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body,
      });
    } catch (err) {
      lastError = err;
      await backoff(attempt);
      continue;
    }

    if (response.ok) {
      // A 200 that is not audio means the API reported something in JSON. Writing
      // it to a .mp3 would produce a file that exists, has a plausible size and
      // plays nothing -- the worst possible failure for a store the addon trusts.
      const type = response.headers.get("content-type") || "";
      if (!type.startsWith("audio/")) {
        throw new Error(
          `response was not audio (content-type ${type}): ${(await response.text()).slice(0, 200)}`,
        );
      }

      const credits = creditsFrom(response.headers);
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.byteLength === 0) throw new Error("ElevenLabs returned an empty response");
      return { audio, credits };
    }

    const text = (await response.text()).slice(0, 300);
    lastError = new Error(`ElevenLabs returned ${response.status}: ${text}`);
    if (!RETRYABLE.has(response.status)) throw lastError;
    if (response.status === 429 && onRateLimit) onRateLimit();
    await backoff(attempt);
  }

  throw lastError;
}

function backoff(attempt) {
  const ms = Math.min(30000, 1000 * 2 ** (attempt - 1));
  return new Promise((r) => setTimeout(r, ms));
}
