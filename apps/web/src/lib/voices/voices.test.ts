import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import { flavorsOf, GENDERS, gendersOf, isVoice, RACES, VOICE_NAMES, VOICES, voiceName } from "./voices";

describe("VOICES", () => {
  // The roster is what /voices, the filters and the triage selects offer, so a corpus line
  // outside it would be spoken in a voice nothing can find or clone.
  it("covers every voice the corpus speaks in", async () => {
    for (const line of (await corpus()).lines) expect(isVoice(line.voice), line.voice).toBe(true);
  });

  it("names each voice the way the corpus does", async () => {
    for (const line of (await corpus()).lines) {
      expect(voiceName({ race: line.race, gender: line.gender as "male" | "female", flavor: line.flavor })).toBe(line.voice);
    }
  });

  it("lists each voice once", () => {
    expect(new Set(VOICE_NAMES).size).toBe(VOICE_NAMES.length);
  });

  it("names races and flavors the way a voice slot can carry them", () => {
    // A slot name is split on dashes and becomes a path segment.
    for (const voice of VOICES) {
      expect(voice.race).toMatch(/^[a-z]+$/);
      if (voice.flavor) expect(voice.flavor).toMatch(/^[a-z0-9]+$/);
    }
  });

  it("does not mix a bare voice with flavored ones for the same race-gender", () => {
    for (const { race, gender } of VOICES) {
      const flavors = VOICES.filter((v) => v.race === race && v.gender === gender).map((v) => v.flavor);
      expect(flavors.includes(null) && flavors.length > 1, `${race}-${gender}`).toBe(false);
    }
  });

  it("derives races, genders and flavors from the roster", () => {
    expect(RACES).toContain("skybourneelf");
    expect(GENDERS).toEqual(["female", "male"]);
    expect(gendersOf("narrator")).toEqual(["male"]);
    expect(flavorsOf("skybourneelf", "male")).toEqual(["3776", "3775"]);
    expect(flavorsOf("narrator", "male")).toEqual([]);
    expect(flavorsOf("murloc", "male")).toEqual([]);
  });
});
