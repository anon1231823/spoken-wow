import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import { declaredFlavors, GENDERS, gendersOf, isVoiced, RACES, unspokenVoices, VOICES } from "./voices";

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

describe("declaredFlavors", () => {
  it("lists a race-gender's voice sets busiest first", () => {
    expect(declaredFlavors("skybourneelf", "male")).toEqual(["3776", "3775"]);
    expect(declaredFlavors("orc", "male")).toEqual([]);
  });

  it("names flavors the way a voice slot can carry them", () => {
    for (const voice of VOICES) for (const flavor of voice.flavors ?? []) expect(flavor).toMatch(/^[a-z0-9]+$/);
  });
});

describe("unspokenVoices", () => {
  const all = new Set(VOICES.map((voice) => `${voice.race}-${voice.gender}`));

  it("names a bare voice only for a race-gender with no flavors and no lines", () => {
    const spoken = new Set(all);
    spoken.delete("bloodelf-male");
    expect(unspokenVoices(spoken, new Set(["skybourneelf-male-3776", "skybourneelf-male-3775",
      "skybourneelf-female-3773", "skybourneelf-female-3774"]))).toEqual(["bloodelf-male"]);
  });

  it("names each declared flavor the corpus does not speak yet, and never a bare one beside them", () => {
    const unspoken = unspokenVoices(all, new Set(["skybourneelf-male-3776"]));
    expect(unspoken).toEqual(["skybourneelf-female-3773", "skybourneelf-female-3774", "skybourneelf-male-3775"]);
  });
});
