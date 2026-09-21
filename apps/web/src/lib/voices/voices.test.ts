import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import { GENDERS, gendersOf, isVoiced, RACES, unspokenVoices, VOICES } from "./voices";

describe("VOICES", () => {
  // The filters, the triage selects and /voices all read this list, so a corpus line outside
  // it would be spoken in a race nothing can filter or pick.
  it("covers every race-gender the corpus speaks in", async () => {
    for (const line of (await corpus()).lines) {
      expect(isVoiced(line.race, line.gender), `${line.race}-${line.gender}`).toBe(true);
    }
  });

  it("lists each race-gender once", () => {
    const names = VOICES.map((voice) => `${voice.race}-${voice.gender}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names races the way a voice slot can carry them", () => {
    // A slot name is split on dashes and becomes a path segment.
    for (const race of RACES) expect(race).toMatch(/^[a-z]+$/);
  });

  it("derives the races and genders from the list", () => {
    expect(RACES).toContain("skybourneelf");
    expect(GENDERS).toEqual(["female", "male"]);
    expect(gendersOf("narrator")).toEqual(["male"]);
  });
});

describe("unspokenVoices", () => {
  it("names only the race-genders not already spoken", () => {
    const spoken = new Set(VOICES.map((voice) => `${voice.race}-${voice.gender}`));
    spoken.delete("skybourneelf-male");
    expect(unspokenVoices(spoken)).toEqual(["skybourneelf-male"]);
  });
});
