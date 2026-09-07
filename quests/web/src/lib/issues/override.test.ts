import { describe, expect, it } from "vitest";
import { MAX_OVERRIDE_LENGTH, OverrideError, validateOverride } from "./override";

const VALID = { file: "quests/1155-accept.mp3", lineId: "q:1155:accept", text: "  A crystal fragment.  " };

describe("validateOverride", () => {
  it("trims the text it will send", () => {
    expect(validateOverride(VALID).text).toBe("A crystal fragment.");
  });

  it("refuses an empty rewrite, and says what to do instead", () => {
    expect(() => validateOverride({ ...VALID, text: "   " })).toThrow(/remove the override/);
  });

  it("refuses the characters an override exists to remove", () => {
    expect(() => validateOverride({ ...VALID, text: "what < is this" })).toThrow(OverrideError);
    expect(() => validateOverride({ ...VALID, text: "in $2113w days" })).toThrow(/unvoiceable/);
  });

  it("accepts either bracketed span, which the narrator and the NPC now voice", () => {
    // The gate stopped calling these damage, and an override is judged by the same gate.
    expect(() => validateOverride({ ...VALID, text: "<Thrall grunts.>" })).not.toThrow();
    expect(() => validateOverride({ ...VALID, text: "<cough> ye brave soul" })).not.toThrow();
  });

  it("refuses a paste", () => {
    const text = "a".repeat(MAX_OVERRIDE_LENGTH + 1);
    expect(() => validateOverride({ ...VALID, text })).toThrow(/too long/);
  });

  it("requires both halves of the identity", () => {
    expect(() => validateOverride({ ...VALID, file: "" })).toThrow(/file is required/);
    expect(() => validateOverride({ ...VALID, lineId: "" })).toThrow(/lineId is required/);
    expect(() => validateOverride(null)).toThrow(OverrideError);
  });
});
