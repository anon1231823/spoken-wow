/**
 * How a line is voiced: the shape of the settings, and the committed defaults.
 *
 * The TypeScript twin of tts_cli/voice_config.py. The field names inside `voiceSettings`
 * stay snake_case because they are sent to ElevenLabs verbatim - the same object
 * build_payload puts on the wire - and renaming them here would mean translating them back
 * at the one place it matters.
 *
 * Nothing in this file touches the database or the filesystem - reading the files lives in
 * files.ts. That split is load-bearing rather than tidy: the settings form is a client
 * component and imports these types and constants, and a `node:fs` anywhere in its import
 * graph fails the production build with an UnhandledSchemeError that neither `pnpm test` nor
 * `pnpm typecheck` will show you.
 */
export const SEED_STRATEGIES = ["none", "npc"] as const;
export type SeedStrategy = (typeof SEED_STRATEGIES)[number];

/** Settings sent to ElevenLabs as `voice_settings`. */
export type VoiceSettings = {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
};

export type GenerationConfig = {
  modelId: string;
  voiceSettings: VoiceSettings;
  seedStrategy: SeedStrategy;
};

/** The unit-interval fields, checked on every write. Same list as _UNIT_INTERVAL in Python. */
export const UNIT_INTERVAL = ["stability", "similarity_boost", "style"] as const;

/**
 * Used only when voice/generation.json cannot be read.
 *
 * Duplicating the committed values is a deliberate trade: a release that forgot to ship the
 * file should still be able to generate, rather than 500 on every attempt. config.test.ts
 * asserts this matches the file exactly, so the copy cannot quietly drift.
 */
export const FALLBACK: GenerationConfig = {
  modelId: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
  },
  seedStrategy: "npc",
};

/** The JSON shape on disk, which is Python's. */
export type GenerationFile = {
  model_id?: unknown;
  voice_settings?: Record<string, unknown>;
  seed_strategy?: unknown;
};

export function isSeedStrategy(value: unknown): value is SeedStrategy {
  return typeof value === "string" && (SEED_STRATEGIES as readonly string[]).includes(value);
}

/**
 * Parse the on-disk shape into ours, filling anything absent from FALLBACK.
 *
 * Field by field rather than object by object: a file that sets only `stability` should keep
 * the committed value for everything else, and an absent field reaching ElevenLabs as null
 * is rejected with an error naming the field rather than the missing config.
 */
export function fromFileShape(raw: GenerationFile): GenerationConfig {
  const settings = raw.voice_settings ?? {};
  const number = (key: keyof VoiceSettings, fallback: number) =>
    typeof settings[key] === "number" && Number.isFinite(settings[key])
      ? (settings[key] as number)
      : fallback;

  return {
    modelId: typeof raw.model_id === "string" && raw.model_id ? raw.model_id : FALLBACK.modelId,
    voiceSettings: {
      stability: number("stability", FALLBACK.voiceSettings.stability),
      similarity_boost: number("similarity_boost", FALLBACK.voiceSettings.similarity_boost),
      style: number("style", FALLBACK.voiceSettings.style),
      use_speaker_boost:
        typeof settings.use_speaker_boost === "boolean"
          ? settings.use_speaker_boost
          : FALLBACK.voiceSettings.use_speaker_boost,
    },
    seedStrategy: isSeedStrategy(raw.seed_strategy) ? raw.seed_strategy : FALLBACK.seedStrategy,
  };
}
