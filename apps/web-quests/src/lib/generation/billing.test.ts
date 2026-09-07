import { describe, expect, it } from "vitest";

import { estimate, estimateCredits, LIST_RATE, roundHalfToEven } from "./billing";

/**
 * The measured behaviour this models. On the account it was built against, ElevenLabs bills
 * round(characters * 0.55) for the standard models and half that for flash and turbo:
 *
 *   100 chars -> 55    50 chars -> 28    200 chars -> 110    529 chars -> 291
 *
 * confirmed against both the `character-cost` response header and the usage-stats delta.
 * 0.55 is a property of that plan, not of ElevenLabs, which is why nothing here hardcodes it.
 */
const MEASURED_RATE = 0.55;

describe("estimateCredits", () => {
  it("reproduces the measured figures at the measured rate", () => {
    expect(estimateCredits(100, MEASURED_RATE)).toBe(55);
    expect(estimateCredits(200, MEASURED_RATE)).toBe(110);
    expect(estimateCredits(529, MEASURED_RATE)).toBe(291);
    expect(estimateCredits(20, MEASURED_RATE)).toBe(11);
    // The line that started this: 310 characters cost 170. It is also the case that pins
    // the rounding down - 310 * 0.55 is exactly 170.5, and half up would give 171.
    expect(estimateCredits(310, MEASURED_RATE)).toBe(170);
    expect(estimateCredits(50, MEASURED_RATE)).toBe(28);
  });

  // Every measured pair fits round half to even and no other simple rule. Math.round would
  // be wrong on 310 and right on 50; truncation wrong on both.
  it("rounds half to even, as the measurements imply", () => {
    expect(roundHalfToEven(27.5)).toBe(28);
    expect(roundHalfToEven(170.5)).toBe(170);
    expect(roundHalfToEven(0.5)).toBe(0);
    expect(roundHalfToEven(1.5)).toBe(2);
    expect(roundHalfToEven(2.5)).toBe(2);
    // Float noise must not tip a value across the boundary: 100 * 0.55 is 55.00000000000001.
    expect(roundHalfToEven(100 * 0.55)).toBe(55);
    expect(roundHalfToEven(290.95)).toBe(291);
    expect(roundHalfToEven(0)).toBe(0);
  });

  it("reproduces the half rate the flash and turbo models bill at", () => {
    expect(estimateCredits(100, MEASURED_RATE / 2)).toBe(28);
    expect(estimateCredits(200, MEASURED_RATE / 2)).toBe(55);
  });

  // Overstating is the right direction to be wrong in for a number whose job is to stop
  // someone spending a month's budget by accident.
  it("falls back to the list rate, which overstates every plan measured", () => {
    expect(LIST_RATE).toBe(1);
    expect(estimateCredits(310, LIST_RATE)).toBe(310);
    expect(estimateCredits(310, LIST_RATE)).toBeGreaterThan(estimateCredits(310, MEASURED_RATE));
  });
});

const rate = { rate: MEASURED_RATE, samples: 50, modelId: "eleven_multilingual_v2" };

describe("estimate", () => {
  it("adds up the lines it is given", () => {
    const result = estimate(
      [
        { file: "quests/1-accept.mp3", characters: 100 },
        { file: "quests/2-accept.mp3", characters: 200 },
      ],
      rate,
    );

    expect(result).toMatchObject({ lines: 2, files: 2, characters: 300, credits: 165 });
  });

  /**
   * The correction that matters. 1,076 files in the corpus are spoken by more than one NPC,
   * because a gossip file is named md5(text + race + gender). The batch generates each file
   * once, so counting per line would overstate the cost - and quietly tell someone a batch
   * is more expensive than it is.
   */
  it("counts a shared file once, however many lines resolve to it", () => {
    const shared = { file: "gossip/31ab.mp3", characters: 100 };
    const result = estimate([shared, { ...shared }, { ...shared }], rate);

    expect(result.lines).toBe(3);
    expect(result.files).toBe(1);
    expect(result.characters).toBe(100);
    expect(result.credits).toBe(55);
  });

  it("is zero for an empty batch rather than NaN", () => {
    expect(estimate([], rate)).toMatchObject({ lines: 0, files: 0, characters: 0, credits: 0 });
  });

  it("carries the rate through, so the UI can say how it was calibrated", () => {
    expect(estimate([], rate).rate).toEqual(rate);
  });
});
