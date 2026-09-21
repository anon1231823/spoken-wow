import { describe, expect, it } from "vitest";

import {
  GAP_SECONDS,
  HEAD_SECONDS,
  LEAD_IN,
  MARGIN_SECONDS,
  MAX_CUT_SECONDS,
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

  // The gossip lines that forced the shape rule: 0.899s and 1.158s pauses, both of which a
  // duration threshold set from longer clips refused to cut.
  it("cuts a short pause, which is what a fast voice gives", () => {
    expect(cutPoint(detected([[0.81, 0.899]]))).toBeCloseTo(1.709 - MARGIN_SECONDS, 2);
    expect(cutPoint(detected([[0.80, 1.158]]))).toBeCloseTo(1.958 - MARGIN_SECONDS, 2);
  });

  // Measured: two clips opened with gaps of 0.32s and 0.21s before the real one.
  it("walks past a breath inside the throat clear", () => {
    const output = detected([[0, 0.32], [0.41, 0.21], [0.86, 2.65]]);
    expect(cutPoint(output)).toBeCloseTo(3.51 - MARGIN_SECONDS, 2);
  });

  // The whole point of the shape rule: a first sound that runs long is speech, and the pause
  // after it is eleven_v3 inserting one nobody asked for.
  it("refuses once the opening sound has run past a throat clear's length", () => {
    expect(cutPoint(detected([[HEAD_SECONDS + 0.1, 2.5]]))).toBeNull();
  });

  it("ignores a gap too short to be the pause", () => {
    expect(cutPoint(detected([[0.8, GAP_SECONDS - 0.1]]))).toBeNull();
  });

  // A slow voice stretches both halves: tauren-male-elder cleared its throat for 1.185s and
  // paused for 3.22s, which is a 4.36s cut and was refused when the backstop was 4s.
  it("cuts a slow voice, which takes longer over both halves", () => {
    expect(cutPoint(detected([[1.185, 3.224]]))).toBeCloseTo(4.409 - MARGIN_SECONDS, 2);
  });

  it("refuses a cut further in than any lead-in has ever ended", () => {
    expect(cutPoint(detected([[1.0, MAX_CUT_SECONDS]]))).toBeNull();
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
