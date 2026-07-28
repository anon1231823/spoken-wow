import { describe, expect, it } from "vitest";

import { FALLBACK } from "./config";
import { SettingsError, validateConfig } from "./settings";

// The shape the settings form sends. Every field, every time: partial updates against a row
// read a moment earlier are how two admins silently overwrite each other.
const VALID = {
  modelId: "eleven_multilingual_v2",
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0,
    use_speaker_boost: true,
  },
  seedStrategy: "npc",
};

describe("validateConfig", () => {
  it("accepts the committed defaults, whatever they currently are", () => {
    expect(validateConfig(FALLBACK)).toEqual(FALLBACK);
  });

  it("accepts a full, valid body", () => {
    expect(validateConfig(VALID)).toEqual(VALID);
  });

  it("trims the model id", () => {
    expect(validateConfig({ ...VALID, modelId: "  eleven_flash_v2_5 " }).modelId).toBe(
      "eleven_flash_v2_5",
    );
  });

  // Same bounds as save_generation in tts_cli/voice_config.py. ElevenLabs rejects these
  // itself, but a 422 arriving mid-batch is a far worse place to learn about it.
  describe("the unit-interval fields", () => {
    for (const key of ["stability", "similarity_boost", "style"] as const) {
      it(`refuses ${key} above 1`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: 1.5 } };
        expect(() => validateConfig(body)).toThrow(SettingsError);
        expect(() => validateConfig(body)).toThrow(/between 0 and 1/);
      });

      it(`refuses ${key} below 0`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: -0.01 } };
        expect(() => validateConfig(body)).toThrow(SettingsError);
      });

      it(`accepts ${key} at both ends of the range`, () => {
        for (const value of [0, 1]) {
          const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: value } };
          expect(validateConfig(body).voiceSettings[key]).toBe(value);
        }
      });

      it(`refuses ${key} as a string, rather than coercing it`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: "0.5" } };
        expect(() => validateConfig(body)).toThrow(/must be a number/);
      });

      it(`refuses ${key} as NaN`, () => {
        const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, [key]: NaN } };
        expect(() => validateConfig(body)).toThrow(/must be a number/);
      });
    }
  });

  it("refuses a seed strategy nothing implements", () => {
    expect(() => validateConfig({ ...VALID, seedStrategy: "per-line" })).toThrow(
      /unknown seed strategy/,
    );
  });

  it("refuses an empty or missing model id", () => {
    expect(() => validateConfig({ ...VALID, modelId: "   " })).toThrow(/non-empty/);
    expect(() => validateConfig({ ...VALID, modelId: undefined })).toThrow(/non-empty/);
  });

  it("refuses a non-boolean speaker boost rather than reading it as truthy", () => {
    const body = { ...VALID, voiceSettings: { ...VALID.voiceSettings, use_speaker_boost: "yes" } };
    expect(() => validateConfig(body)).toThrow(/must be a boolean/);
  });

  it("refuses bodies that are not objects at all", () => {
    for (const body of [null, undefined, "settings", 42, []]) {
      expect(() => validateConfig(body)).toThrow(SettingsError);
    }
  });

  it("refuses a body with no voiceSettings", () => {
    expect(() => validateConfig({ modelId: "m", seedStrategy: "npc" })).toThrow(/voiceSettings/);
  });

  // Anything the form does not send is dropped rather than carried into the database, where
  // it would be sent to ElevenLabs on every line thereafter.
  it("keeps only the fields it knows", () => {
    const result = validateConfig({
      ...VALID,
      speed: 1.4,
      voiceSettings: { ...VALID.voiceSettings, speed: 1.4 },
    });
    expect(result).toEqual(VALID);
  });
});
