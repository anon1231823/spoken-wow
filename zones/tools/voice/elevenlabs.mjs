// The only module here that talks to the network.
//
// Kept separate so the selection and dry-run paths -- everything that costs
// nothing -- can be exercised without an API key.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../lib/loredata.mjs";

const VOICES_URL = "https://api.elevenlabs.io/v1/voices";
const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export const CONFIG_PATH = join(ROOT, "tools/voice/config.json");

//------------------------------------------------------------------------------
// Credentials
//------------------------------------------------------------------------------

// A five-line .env reader rather than a dependency, matching this repo's other
// tools, which have none. Ambient environment wins nothing: a key exported for
// another project is exactly the mix-up ../wow-voiceover/tts_cli/env_vars.py
// documents having been bitten by.
export async function apiKey() {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of (await readFile(envPath, "utf8")).split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*)$/);
      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, "");
        if (value) return value;
      }
    }
  }
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;

  throw new Error(
    "no ELEVENLABS_API_KEY.\n" +
      `  Put it in ${envPath} as:  ELEVENLABS_API_KEY=sk_...\n` +
      "  (.env is gitignored.)",
  );
}

//------------------------------------------------------------------------------
// Config
//------------------------------------------------------------------------------

export async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
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
export async function resolveVoiceId(config, key) {
  if (config.voiceId) return config.voiceId;

  const response = await fetch(VOICES_URL, { headers: { "xi-api-key": key } });
  if (!response.ok) {
    throw new Error(
      `could not list voices (${response.status}): ${(await response.text()).slice(0, 200)}`,
    );
  }

  const { voices } = await response.json();
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

export function buildPayload(spokenText, config) {
  return {
    text: spokenText,
    model_id: config.modelId,
    voice_settings: config.voiceSettings,
  };
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export async function synthesize(spokenText, config, key, { attempts = 4 } = {}) {
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
      return Buffer.from(await response.arrayBuffer());
    }

    const text = (await response.text()).slice(0, 300);
    lastError = new Error(`ElevenLabs returned ${response.status}: ${text}`);
    if (!RETRYABLE.has(response.status)) throw lastError;
    await backoff(attempt);
  }

  throw lastError;
}

function backoff(attempt) {
  const ms = Math.min(30000, 1000 * 2 ** (attempt - 1));
  return new Promise((r) => setTimeout(r, ms));
}
