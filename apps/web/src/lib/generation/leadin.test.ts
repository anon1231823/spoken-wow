import { describe, expect, it } from "vitest";

import {
  GAP_SECONDS,
  LEAD_IN,
  MARGIN_SECONDS,
  WINDOW_SECONDS,
  cutPoint,
  performsTags,
  withLeadIn,
} from "./leadin";

/** silencedetect writes one line per boundary, on stderr, at info level. */
function detected(gaps: [number, number][]): string {
  return gaps
    .flatMap(([start, duration]) => [
      `[silencedetect @ 0x14e0058c0] silence_start: ${start}`,
      `[silencedetect @ 0x14e0058c0] silence_end: ${start + duration} | silence_duration: ${duration}`,
    ])
    .join("\n");
}

describe("performsTags", () => {
  it("is eleven_v3 only", () => {
    expect(performsTags("eleven_v3")).toBe(true);
    expect(performsTags("eleven_flash_v2")).toBe(false);
    expect(performsTags("eleven_multilingual_v2")).toBe(false);
  });
});

describe("withLeadIn", () => {
  it("prefixes text for a model that performs the tags", () => {
    expect(withLeadIn("The tauren keep to the plains.", "eleven_v3")).toBe(
      `${LEAD_IN}The tauren keep to the plains.`,
    );
  });

  // A model that reads the brackets aloud would say "clears throat" in the narrator's voice,
  // which is worse than the ramp-up this exists to remove.
  it("leaves text alone for a model that would read the tags", () => {
    expect(withLeadIn("The tauren keep to the plains.", "eleven_multilingual_v2")).toBe(
      "The tauren keep to the plains.",
    );
  });
});

describe("cutPoint", () => {
  it("is just before speech resumes after the lead-in gap", () => {
    expect(cutPoint(detected([[0.84, 2.28]]))).toBeCloseTo(3.12 - MARGIN_SECONDS, 2);
  });

  it("ignores gaps shorter than the lead-in pause", () => {
    expect(cutPoint(detected([[0.5, GAP_SECONDS - 0.1]]))).toBeNull();
  });

  // The measured lead-in ends between 3.11s and 3.32s; a sentence pause this late is the
  // narrator breathing, and cutting there would eat the opening sentence.
  it("ignores a long gap that arrives after the window", () => {
    expect(cutPoint(detected([[WINDOW_SECONDS + 1, 2.5]]))).toBeNull();
  });

  it("takes the first qualifying gap when a later one is longer", () => {
    expect(cutPoint(detected([[0.8, 2.0], [5.0, 3.0]]))).toBeCloseTo(2.8 - MARGIN_SECONDS, 2);
  });

  it("is null when the model ignored the tag and produced no gap", () => {
    expect(cutPoint("")).toBeNull();
  });

  // An unterminated silence_start is what a clip that ends in silence produces; there is no
  // silence_end to cut at, so there is nothing to trim.
  it("is null when the gap never closes", () => {
    expect(cutPoint("[silencedetect @ 0x1] silence_start: 0.84")).toBeNull();
  });
});
