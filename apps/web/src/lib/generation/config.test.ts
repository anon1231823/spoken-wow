import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { VOICE_CONFIG_DIR } from "@/lib/paths";
import { FALLBACK, fromFileShape, isSeedStrategy } from "./config";
import {
  generationPath,
  pronunciationPath,
  readGenerationFile,
  readPronunciationFile,
} from "./files";

const temporary: string[] = [];

function scratch(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voice-config-"));
  temporary.push(dir);
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

afterAll(() => {
  for (const dir of temporary) fs.rmSync(dir, { recursive: true, force: true });
});

// The one test that earns FALLBACK's existence. It is a hand-maintained copy of committed
// data, so without this it would drift the first time anyone tunes generation.json and the
// droplet would generate with values nobody chose.
describe("FALLBACK", () => {
  it("matches voice/generation.json exactly", () => {
    expect(readGenerationFile(VOICE_CONFIG_DIR)).toEqual(FALLBACK);
  });

  it("is what a missing file falls back to", () => {
    expect(readGenerationFile(scratch({}))).toEqual(FALLBACK);
  });

  it("is what an unparseable file falls back to", () => {
    expect(readGenerationFile(scratch({ "generation.json": "{ not json" }))).toEqual(FALLBACK);
  });
});

describe("fromFileShape", () => {
  it("reads Python's snake_case shape", () => {
    expect(
      fromFileShape({
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability: 0.28,
          similarity_boost: 0.992,
          style: 0.1,
          use_speaker_boost: false,
        },
        seed_strategy: "none",
        race_tags: { dwarf: "[Scottish accent]" },
      }),
    ).toEqual({
      modelId: "eleven_turbo_v2_5",
      voiceSettings: {
        stability: 0.28,
        similarity_boost: 0.992,
        style: 0.1,
        use_speaker_boost: false,
      },
      seedStrategy: "none",
      raceTags: { dwarf: "[Scottish accent]" },
    });
  });

  // A tag that is not a string would reach the spoken text as "undefined" and be read aloud,
  // the same failure readPronunciationFile guards against for replacements.
  it("drops race tags that are not strings", () => {
    expect(fromFileShape({ race_tags: { dwarf: "[Scottish accent]", gnome: 3 } }).raceTags).toEqual(
      { dwarf: "[Scottish accent]" },
    );
  });

  it("treats a race_tags array as no tags rather than reading its indices", () => {
    expect(fromFileShape({ race_tags: ["[Scottish accent]"] }).raceTags).toEqual({});
  });

  // A field the file omits must not become undefined and reach ElevenLabs as null: the API
  // rejects the request, and the failure names the field rather than the missing config.
  it("fills each absent field from the defaults independently", () => {
    expect(fromFileShape({ voice_settings: { stability: 0.9 } })).toEqual({
      ...FALLBACK,
      voiceSettings: { ...FALLBACK.voiceSettings, stability: 0.9 },
    });
  });

  it("refuses a seed strategy the code does not implement", () => {
    expect(fromFileShape({ seed_strategy: "per-line" }).seedStrategy).toBe(FALLBACK.seedStrategy);
  });

  it("keeps the committed tags when the file omits race_tags", () => {
    expect(fromFileShape({ model_id: "eleven_v3" }).raceTags).toEqual(FALLBACK.raceTags);
  });

  it("refuses an empty model id", () => {
    expect(fromFileShape({ model_id: "" }).modelId).toBe(FALLBACK.modelId);
  });
});

describe("isSeedStrategy", () => {
  it("accepts only the implemented strategies", () => {
    expect(isSeedStrategy("npc")).toBe(true);
    expect(isSeedStrategy("none")).toBe(true);
    expect(isSeedStrategy("random")).toBe(false);
    expect(isSeedStrategy(null)).toBe(false);
  });
});

describe("readPronunciationFile", () => {
  it("reads the committed rules", () => {
    const rules = readPronunciationFile(VOICE_CONFIG_DIR);
    expect(Object.keys(rules).length).toBeGreaterThan(0);
    for (const value of Object.values(rules)) expect(typeof value).toBe("string");
  });

  it("treats an absent file as no rules rather than an error", () => {
    expect(readPronunciationFile(scratch({}))).toEqual({});
  });

  // A JSON array or a non-string replacement would otherwise reach String.replace and turn
  // into the literal text "undefined" inside a voiceline.
  it("drops entries that are not string replacements", () => {
    const dir = scratch({ "pronunciation.json": '{"a": "b", "c": 3, "d": null}' });
    expect(readPronunciationFile(dir)).toEqual({ a: "b" });
  });

  it("treats a top-level array as no rules", () => {
    expect(readPronunciationFile(scratch({ "pronunciation.json": "[1,2]" }))).toEqual({});
  });
});

describe("paths", () => {
  // Two, not three: the lexicon lives in the database and is never read off disk.
  it("names the files the Python side reads", () => {
    expect(generationPath("/x")).toBe(path.join("/x", "generation.json"));
    expect(pronunciationPath("/x")).toBe(path.join("/x", "pronunciation.json"));
  });
});
