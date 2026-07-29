import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { VOICE_CONFIG_DIR } from "@/lib/paths";
import { FALLBACK, fromFileShape, isSeedStrategy } from "./config";
import {
  generationPath,
  lexiconPath,
  pronunciationPath,
  readGenerationFile,
  readLexiconFile,
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
    });
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

describe("readLexiconFile", () => {
  it("reads the committed lexicon", () => {
    const entries = readLexiconFile(VOICE_CONFIG_DIR);
    expect(entries.length).toBeGreaterThan(0);

    // Gnomeregan is the load-bearing case: the silent G is the single most-mangled word in
    // the corpus, and a lexicon that has lost it has lost the point of existing.
    const gnomeregan = entries.find((entry) => entry.grapheme === "Gnomeregan");
    expect(gnomeregan?.ipa).toBeTruthy();
  });

  it("treats an absent file as an empty lexicon rather than an error", () => {
    expect(readLexiconFile(scratch({}))).toEqual([]);
  });

  it("treats a file with no entries array as an empty lexicon", () => {
    expect(readLexiconFile(scratch({ "lexicon.json": '{"entries": {}}' }))).toEqual([]);
    expect(readLexiconFile(scratch({ "lexicon.json": "[]" }))).toEqual([]);
  });

  // One malformed entry hand-edited into the file should cost that one name, not every name.
  it("drops an invalid entry and keeps the rest", () => {
    const dir = scratch({
      "lexicon.json": JSON.stringify({
        entries: [
          { grapheme: "Thrall", ipa: "θɹɔl", say: "thrawl", confidence: "high", category: "character" },
          { grapheme: "Broken", ipa: "", say: "", confidence: "high", category: "place" },
        ],
      }),
    });
    expect(readLexiconFile(dir).map((entry) => entry.grapheme)).toEqual(["Thrall"]);
  });
});

describe("paths", () => {
  it("names the files the Python side reads", () => {
    expect(generationPath("/x")).toBe(path.join("/x", "generation.json"));
    expect(pronunciationPath("/x")).toBe(path.join("/x", "pronunciation.json"));
    expect(lexiconPath("/x")).toBe(path.join("/x", "lexicon.json"));
  });
});
