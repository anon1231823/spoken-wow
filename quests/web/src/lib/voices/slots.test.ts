import { describe, expect, it } from "vitest";

import { isVoiceSlot, slots } from "./slots";

describe("slots", () => {
  it("derives the voices the corpus actually needs", () => {
    const names = slots().map((s) => s.name);
    expect(names).toContain("orc-male-shady");
    expect(names).toContain("narrator-male");
    // Every name must be the race-gender[-flavor] shape tts_cli/voices.py matches on, or the
    // Python side will not find the voice we create. The flavor is optional: narrator-male
    // is a pseudo-race for gameobjects with no NPC voice sets to choose between.
    for (const name of names) expect(name).toMatch(/^[a-z]+-(male|female)(-[a-z]+)?$/);
  });

  it("orders alphabetically", () => {
    const names = slots().map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("counts only generatable lines", () => {
    // Progress text is never voiced, so a voice's line count must be below the raw total.
    const total = slots().reduce((sum, s) => sum + s.lineCount, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(17507);
  });
});

describe("isVoiceSlot", () => {
  it("accepts every derived slot", () => {
    for (const slot of slots()) expect(isVoiceSlot(slot.name)).toBe(true);
  });

  it("refuses anything outside the set", () => {
    expect(isVoiceSlot("orc-mail")).toBe(false);
    expect(isVoiceSlot("")).toBe(false);
  });

  // These are the reason the check is set membership rather than a regex: a slot name
  // becomes a path segment, so a traversal must fail on the same code path as a typo.
  it("refuses path traversal", () => {
    expect(isVoiceSlot("../audio")).toBe(false);
    expect(isVoiceSlot("../../etc/passwd")).toBe(false);
    expect(isVoiceSlot("/etc/passwd")).toBe(false);
    expect(isVoiceSlot("orc-male/../..")).toBe(false);
    expect(isVoiceSlot("orc-male%2f..")).toBe(false);
  });
});
