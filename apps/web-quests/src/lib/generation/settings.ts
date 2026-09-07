/**
 * The global generation settings: reading them, and changing them safely.
 *
 * Two layers. voice/generation.json ships in the release and is what the Python CLI reads;
 * the generation_setting row, when present, is what the web app generates with. Reading
 * reports which of the two is in force, because "why does this sound different from what
 * the CLI made" is otherwise unanswerable.
 *
 * Validation mirrors save_generation in tts_cli/voice_config.py. It lives on the write path
 * rather than the read path on purpose: a value already in the database is a fact, and
 * refusing to read it would take the settings page down exactly when it is needed to fix it.
 */
import { db } from "@/lib/db";

import {
  isSeedStrategy,
  UNIT_INTERVAL,
  type GenerationConfig,
  type VoiceSettings,
} from "./config";
import { fileDefaults } from "./files";

export type EffectiveSettings = {
  config: GenerationConfig;
  /** Whether the row exists, i.e. whether anyone has overridden the committed defaults. */
  source: "file" | "database";
  /** The committed values, so the page can offer "reset to defaults" and show the delta. */
  defaults: GenerationConfig;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Row = {
  modelId: string;
  voiceSettings: VoiceSettings;
  seedStrategy: string;
  updatedAt: string;
  updatedBy: string | null;
};

export async function readSettings(): Promise<EffectiveSettings> {
  const defaults = fileDefaults().config;

  const { rows } = await db().query<Row>(
    `select "modelId", "voiceSettings", "seedStrategy", "updatedAt", "updatedBy"
       from "generation_setting" where "id"`,
  );

  const row = rows[0];
  if (!row) {
    return { config: defaults, source: "file", defaults, updatedAt: null, updatedBy: null };
  }

  return {
    config: {
      modelId: row.modelId,
      voiceSettings: row.voiceSettings,
      // Defended rather than trusted: the column is text, and a strategy the code does not
      // implement must fall back to a working one instead of throwing mid-generation.
      seedStrategy: isSeedStrategy(row.seedStrategy) ? row.seedStrategy : defaults.seedStrategy,
    },
    source: "database",
    defaults,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** The settings actually used to generate. Convenience over readSettings for the hot path. */
export async function currentConfig(): Promise<GenerationConfig> {
  return (await readSettings()).config;
}

export class SettingsError extends Error {}

/**
 * Coerce and check an untrusted body into a config, or throw SettingsError.
 *
 * Whole-object rather than patch semantics: the settings page always sends every field, and
 * a partial update against a row read a moment earlier is how two admins silently overwrite
 * each other.
 */
export function validateConfig(input: unknown): GenerationConfig {
  if (!input || typeof input !== "object") throw new SettingsError("expected a settings object");
  const raw = input as Record<string, unknown>;

  const modelId = raw.modelId;
  if (typeof modelId !== "string" || !modelId.trim()) {
    throw new SettingsError("modelId must be a non-empty string");
  }

  const settings = raw.voiceSettings;
  if (!settings || typeof settings !== "object") {
    throw new SettingsError("voiceSettings must be an object");
  }
  const values = settings as Record<string, unknown>;

  const voiceSettings = { use_speaker_boost: true } as VoiceSettings;
  for (const key of UNIT_INTERVAL) {
    const value = values[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new SettingsError(`${key} must be a number`);
    }
    if (value < 0 || value > 1) {
      throw new SettingsError(`${key} must be between 0 and 1, got ${value}`);
    }
    voiceSettings[key] = value;
  }
  if (typeof values.use_speaker_boost !== "boolean") {
    throw new SettingsError("use_speaker_boost must be a boolean");
  }
  voiceSettings.use_speaker_boost = values.use_speaker_boost;

  if (!isSeedStrategy(raw.seedStrategy)) {
    throw new SettingsError(`unknown seed strategy ${JSON.stringify(raw.seedStrategy)}`);
  }

  return { modelId: modelId.trim(), voiceSettings, seedStrategy: raw.seedStrategy };
}

export async function writeSettings(config: GenerationConfig, updatedBy: string): Promise<void> {
  await db().query(
    `insert into "generation_setting"
       ("id", "modelId", "voiceSettings", "seedStrategy", "updatedAt", "updatedBy")
     values (true, $1, $2, $3, now(), $4)
     on conflict ("id") do update set
       "modelId"       = excluded."modelId",
       "voiceSettings" = excluded."voiceSettings",
       "seedStrategy"  = excluded."seedStrategy",
       "updatedAt"     = excluded."updatedAt",
       "updatedBy"     = excluded."updatedBy"`,
    [config.modelId, JSON.stringify(config.voiceSettings), config.seedStrategy, updatedBy],
  );
}

/** Drop the override, so the committed defaults are in force again. */
export async function resetSettings(): Promise<void> {
  await db().query(`delete from "generation_setting" where "id"`);
}
