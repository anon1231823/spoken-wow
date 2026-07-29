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
    }
  });

  it("offers nothing the corpus does not use", () => {
    const races = new Set(corpus.lines.map((l) => l.race));
    expect(facets.races.every((race) => races.has(race))).toBe(true);
  });

  it("is deduplicated and sorted, because it is rendered as-is", () => {
    for (const values of [facets.races, facets.genders, facets.voices]) {
      expect(values.length).toBeGreaterThan(0);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    }
  });
});
