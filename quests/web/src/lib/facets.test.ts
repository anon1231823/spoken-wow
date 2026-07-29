import { describe, expect, it } from "vitest";

import { loadCorpus } from "./corpus";
import { buildFacets } from "./facets";

const corpus = loadCorpus();
const facets = buildFacets();

describe("facets", () => {
  it("offers every value the corpus actually uses", () => {
    // The point of deriving these: a race added upstream in tts_cli/consts.py cannot leave
    // the filter bar quietly unable to select it.
    for (const line of corpus.lines) {
      expect(facets.races).toContain(line.race);
      expect(facets.genders).toContain(line.gender);
      expect(facets.voices).toContain(line.voice);
      if (line.flavor) expect(facets.flavors).toContain(line.flavor);
    }
  });

  it("offers nothing the corpus does not use", () => {
    const races = new Set(corpus.lines.map((l) => l.race));
    expect(facets.races.every((race) => races.has(race))).toBe(true);
  });

  // narrator-male and bloodelf-female have no NPC voice sets, so their lines carry no
  // flavor - and a blank entry in the dropdown would filter to nothing selectable.
  it("leaves out the lines with no flavor", () => {
    expect(corpus.lines.some((l) => l.flavor === null)).toBe(true);
    expect(facets.flavors).not.toContain(null);
    expect(facets.flavors.every((f) => f.length > 0)).toBe(true);
  });

  // What lets the flavor dropdown narrow to a chosen race and gender: only tauren, troll and
  // orc have a shaman voice, and offering the other forty-nine flavors against tauren would
  // mostly offer ways to select nothing.
  describe("flavorScopes", () => {
    it("pairs every flavored line's race, gender and flavor", () => {
      const keys = new Set(facets.flavorScopes.map((s) => `${s.race}-${s.gender}-${s.flavor}`));
      for (const line of corpus.lines) {
        if (line.flavor) expect(keys).toContain(`${line.race}-${line.gender}-${line.flavor}`);
      }
    });

    it("pairs nothing the corpus does not", () => {
      const keys = new Set(
        corpus.lines.filter((l) => l.flavor).map((l) => `${l.race}-${l.gender}-${l.flavor}`),
      );
      expect(facets.flavorScopes).toHaveLength(keys.size);
      for (const scope of facets.flavorScopes) {
        expect(keys).toContain(`${scope.race}-${scope.gender}-${scope.flavor}`);
      }
    });

    it("narrows a race-gender to the flavors it actually has", () => {
      const under = (race: string, gender: string) =>
        facets.flavorScopes
          .filter((s) => s.race === race && s.gender === gender)
          .map((s) => s.flavor);

      expect(under("orc", "female").sort()).toEqual(["shaman", "standard", "warrior"]);
      // The one race-gender with a single voice, and the one with no standard.
      expect(under("goblin", "female")).toEqual(["zany"]);
      expect(under("tauren", "male")).not.toContain("standard");
    });
  });

  it("is deduplicated and sorted, because it is rendered as-is", () => {
    for (const values of [facets.races, facets.genders, facets.flavors, facets.voices]) {
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    }
  });
});
