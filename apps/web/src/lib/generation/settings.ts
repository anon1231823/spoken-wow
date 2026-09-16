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
  raceTags: Record<string, string> | null;
  updatedAt: string;
  updatedBy: string | null;
};

export async function readSettings(): Promise<EffectiveSettings> {
  const defaults = fileDefaults().config;

  const { rows } = await db().query<Row>(
    `select "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy"
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
      // Empty, not the committed tags, when the column is null: a row written by the release
      // before this column existed said nothing about accents, and inheriting the file's
      // tags would start tagging lines that nobody asked to have tagged.
      raceTags: row.raceTags ?? {},
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

  return {
    modelId: modelId.trim(),
    voiceSettings,
    seedStrategy: raw.seedStrategy,
    raceTags: validateRaceTags(raw.raceTags),
  };
}

/**
 * The accent directions, checked for the ways a tag can quietly do the wrong thing.
 *
 * Shape only: the race keys are not checked against the corpus. Validating them would mean
 * loading the corpus on every settings write, and the form offers the races it already knows
 * from facets, so a name no line carries is not reachable through the UI - it would simply
 * match nothing, which is the same as not setting it.
 */
export function validateRaceTags(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsError("raceTags must be an object");
  }

  const tags: Record<string, string> = {};
  for (const [race, tag] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tag !== "string") throw new SettingsError(`the ${race} tag must be a string`);
    const trimmed = tag.trim();
    if (!trimmed) throw new SettingsError(`the ${race} tag is empty; remove it instead`);
    // narration.ts splits speech from stage directions on angle brackets, so a tag carrying
    // one would be read by the narrator rather than tagging the race it belongs to.
    if (/[<>]/.test(trimmed)) {
      throw new SettingsError(`the ${race} tag must not contain an angle bracket`);
    }
    tags[race] = trimmed;
  }
  return tags;
}

export async function writeSettings(config: GenerationConfig, updatedBy: string): Promise<void> {
  await db().query(
    `insert into "generation_setting"
       ("id", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
     values (true, $1, $2, $3, $4, now(), $5)
     on conflict ("id") do update set
       "modelId"       = excluded."modelId",
       "voiceSettings" = excluded."voiceSettings",
       "seedStrategy"  = excluded."seedStrategy",
       -- "raceTags" deliberately absent: they are edited on /voices, by writeRaceTags, and
       -- the settings form no longer shows them. Its config carries whatever they were when
       -- the page loaded, so writing those back would let a Save on the model silently
       -- revert a direction somebody set in the meantime. The insert above still seeds them,
       -- because a row being created has no earlier value to preserve.
       "updatedAt"     = excluded."updatedAt",
       "updatedBy"     = excluded."updatedBy"`,
    [
      config.modelId,
      JSON.stringify(config.voiceSettings),
      config.seedStrategy,
      JSON.stringify(config.raceTags),
      updatedBy,
    ],
  );
}

/**
 * Change the accent directions and nothing else.
 *
 * Its own write, rather than a field of the settings form, because the two are edited in
 * different places for different reasons: a tag belongs to one race and is set while looking
 * at that race's voices, whereas stability applies to everything and is set once. Sending the
 * whole config to change a tag would make a tag edit capable of reverting a model change made
 * a minute earlier in another tab.
 *
 * Whole-map rather than per-race, though. Removing a tag is as much an edit as adding one,
 * and a merge could not express it.
 *
 * The row has to exist to hold a tag, so this creates it from the committed defaults when it
 * does not - which overrides the model and the voice settings too, at whatever the file says
 * right now. readSettings reports the source, so the page can say so rather than leaving
 * someone to discover it.
 */
export async function writeRaceTags(
  tags: Record<string, string>,
  updatedBy: string | null,
): Promise<void> {
  const defaults = fileDefaults().config;
  await db().query(
    `insert into "generation_setting"
       ("id", "modelId", "voiceSettings", "seedStrategy", "raceTags", "updatedAt", "updatedBy")
     values (true, $1, $2, $3, $4, now(), $5)
     on conflict ("id") do update set
       "raceTags"  = excluded."raceTags",
       "updatedAt" = excluded."updatedAt",
       "updatedBy" = excluded."updatedBy"`,
    [
      defaults.modelId,
      JSON.stringify(defaults.voiceSettings),
      defaults.seedStrategy,
      JSON.stringify(tags),
      updatedBy,
    ],
  );
}

/** Drop the override, so the committed defaults are in force again. */
export async function resetSettings(): Promise<void> {
  await db().query(`delete from "generation_setting" where "id"`);
}
