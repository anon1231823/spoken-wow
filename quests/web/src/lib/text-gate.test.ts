import { describe, expect, it } from "vitest";
import { hasInvalidChars, isVoiceable } from "./text-gate";

describe("hasInvalidChars", () => {
  it("catches the template tokens the game expands and we do not", () => {
    expect(hasInvalidChars("It should all arrive in less than $2113w days.")).toBe(true);
    expect(hasInvalidChars("Hi $N.")).toBe(true);
  });

  it("no longer catches a capitalised stage direction, which the narrator reads", () => {
    expect(hasInvalidChars("<Thrall grunts.>")).toBe(false);
  });

  it("still catches a bracket no narrator can take", () => {
    // Lowercase is a sound the NPC makes, and unbalanced is simply damage.
    expect(hasInvalidChars("<cough>")).toBe(true);
    expect(hasInvalidChars("What < is this")).toBe(true);
  });

  it("passes ordinary text, punctuation and apostrophe names alike", () => {
    expect(hasInvalidChars("I hate those nasty timber wolves!")).toBe(false);
    expect(hasInvalidChars("Kel'Thuzad -- the lich -- waits.")).toBe(false);
  });
});

describe("isVoiceable", () => {
  it("rescues an invalid-chars line whose text has been rewritten", () => {
    const line = { skipReason: "invalid-chars" };
    expect(isVoiceable(line, "Meet me in $B Ironforge")).toBe(false);
    expect(isVoiceable(line, "Meet me in Ironforge")).toBe(true);
  });

  it("voices a capitalised stage direction, which the narrator reads", () => {
    // Was refused until the narrator existed to read it. lib/generation/narration.ts splits it
    // out; here it only has to stop counting as damage.
    expect(isVoiceable({ skipReason: "invalid-chars" }, "<Thrall grunts.>")).toBe(true);
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Excellent. <He reads.>")).toBe(true);
  });

  it("still refuses a lowercase sound, which nothing voices yet", () => {
    // <hic> is the NPC hiccuping. Until an audio tag handles it, silence beats a narrator
    // reading the word.
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Ye're brave... <cough>...")).toBe(false);
  });

  it("still refuses an unbalanced bracket", () => {
    expect(isVoiceable({ skipReason: "invalid-chars" }, "What < is this")).toBe(false);
  });

  it("still refuses a template token beside a direction", () => {
    expect(isVoiceable({ skipReason: "invalid-chars" }, "Hello $N. <He waves.>")).toBe(false);
  });

  it("still refuses progress text whatever its brackets", () => {
    expect(isVoiceable({ skipReason: "progress" }, "<He waits.>")).toBe(false);
  });

  it("never rescues progress text, which is skipped by policy rather than by damage", () => {
    expect(isVoiceable({ skipReason: "progress" }, "perfectly ordinary text")).toBe(false);
  });

  it("still refuses a clean line that an override has broken", () => {
    expect(isVoiceable({ skipReason: null }, "Meet me in $B Ironforge")).toBe(false);
  });

  it("passes a line the corpus already voices", () => {
    expect(isVoiceable({ skipReason: null }, "Meet me in Ironforge.")).toBe(true);
  });
});
