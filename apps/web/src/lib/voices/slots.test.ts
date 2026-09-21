import { describe, expect, it } from "vitest";

import { isVoiceSlot, slots } from "./slots";
import { VOICE_NAMES } from "./voices";

describe("slots", () => {
  it("lists the roster", async () => {
    const names = (await slots()).map((s) => s.name);
    expect(names).toContain("orc-male-shady");
    expect(names).toContain("narrator-male");
    // Every name must be the race-gender[-flavor] shape tts_cli/voices.py matches on, or the
    // Python side will not find the voice we create. The flavor is optional: narrator-male
    // is a pseudo-race for gameobjects with no NPC voice sets to choose between.
    // A placeholder flavor may be a voice set's id (voices.ts), hence the digits.
    for (const name of names) expect(name).toMatch(/^[a-z]+-(male|female)(-[a-z0-9]+)?$/);
  });

  it("offers a voice the corpus does not speak yet, so it can be cloned first", async () => {
    // The corpus picks up a voice as contributions are accepted -- both male sets and one
    // female set speak since the first Skybourne lines landed -- so this names the one set no
    // line has reached. Move it to another silent set when this one starts speaking.
    const slot = (await slots()).find((s) => s.name === "skybourneelf-female-3774");
    expect(slot).toEqual({ name: "skybourneelf-female-3774", lineCount: 0, npcCount: 0 });
    expect((await slots()).map((s) => s.name)).not.toContain("skybourneelf-female");
  });

  it("is exactly the roster in voices.ts", async () => {
    const names = (await slots()).map((s) => s.name);
    expect([...names].sort()).toEqual([...VOICE_NAMES].sort());
  });

  it("orders alphabetically", async () => {
    const names = (await slots()).map((s) => s.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("counts only generatable lines", async () => {
    // Progress text is never voiced, so a voice's line count must be below the raw total.
    const total = (await slots()).reduce((sum, s) => sum + s.lineCount, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(17564);
  });
});

describe("isVoiceSlot", () => {
  it("accepts every derived slot", async () => {
    for (const slot of (await slots())) expect(await isVoiceSlot(slot.name)).toBe(true);
  });

  it("refuses anything outside the set", async () => {
    expect(await isVoiceSlot("orc-mail")).toBe(false);
    expect(await isVoiceSlot("")).toBe(false);
  });

  // These are the reason the check is set membership rather than a regex: a slot name
  // becomes a path segment, so a traversal must fail on the same code path as a typo.
  it("refuses path traversal", async () => {
    expect(await isVoiceSlot("../audio")).toBe(false);
    expect(await isVoiceSlot("../../etc/passwd")).toBe(false);
    expect(await isVoiceSlot("/etc/passwd")).toBe(false);
    expect(await isVoiceSlot("orc-male/../..")).toBe(false);
    expect(await isVoiceSlot("orc-male%2f..")).toBe(false);
  });
});
