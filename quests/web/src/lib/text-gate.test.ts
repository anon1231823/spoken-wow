import { describe, expect, it } from "vitest";
import { hasInvalidChars, isVoiceable } from "./text-gate";

describe("hasInvalidChars", () => {
  it("catches the template tokens the game expands and we do not", () => {
    expect(hasInvalidChars("It should all arrive in less than $2113w days.")).toBe(true);
    expect(hasInvalidChars("Hi $N.")).toBe(true);
  });

  it("catches stage directions written for a reader", () => {
    expect(hasInvalidChars("<Thrall grunts.>")).toBe(true);
  });

  it("passes ordinary text, punctuation and apostrophe names alike", () => {
    expect(hasInvalidChars("I hate those nasty timber wolves!")).toBe(false);
    expect(hasInvalidChars("Kel'Thuzad -- the lich -- waits.")).toBe(false);
  });
});

describe("isVoiceable", () => {
  it("rescues an invalid-chars line whose text has been rewritten", () => {
    const line = { skipReason: "invalid-chars" };
    expect(isVoiceable(line, "<Thrall grunts.>")).toBe(false);
    expect(isVoiceable(line, "Thrall grunts.")).toBe(true);
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
