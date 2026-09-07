import { describe, expect, it } from "vitest";
import { IssueError, categoryGroup, categoryLabel, coveredByLexicon, validateVerdict } from "./issues";

const LEXICON = new Set(["gnomeregan", "hakkar", "kel'thuzad", "naga", "azeroth"]);

describe("coveredByLexicon", () => {
  it("matches regardless of case, because entries are written once and casings derived", () => {
    expect(coveredByLexicon("Gnomeregan", LEXICON)).toBe(true);
    expect(coveredByLexicon("GNOMEREGAN", LEXICON)).toBe(true);
  });

  it("answers a possessive with the entry for the name", () => {
    expect(coveredByLexicon("gnomeregans", LEXICON)).toBe(true);
  });

  it("answers a derived form with the entry it is derived from", () => {
    expect(coveredByLexicon("hakkari", LEXICON)).toBe(true);
    expect(coveredByLexicon("kel'thuzad's", LEXICON)).toBe(true);
  });

  it("does not let a short entry answer everything that starts with it", () => {
    // "naga" is four characters, under the floor, so it cannot claim Nagaz or Nagar.
    expect(coveredByLexicon("nagaz", LEXICON)).toBe(false);
  });

  it("leaves an unrelated name uncovered", () => {
    expect(coveredByLexicon("astranaar", LEXICON)).toBe(false);
  });
});

describe("categoryLabel", () => {
  it("renders an unfamiliar category as itself rather than blank", () => {
    expect(categoryLabel("name-apostrophe")).toBe("Apostrophe name");
    expect(categoryLabel("something-the-scan-grew")).toBe("something-the-scan-grew");
  });
});

describe("categoryGroup", () => {
  it("takes everything before the first hyphen", () => {
    expect(categoryGroup("name-drifts-to-english")).toBe("name");
    expect(categoryGroup("bug-source-typo")).toBe("bug");
    expect(categoryGroup("ungrouped")).toBe("ungrouped");
  });
});

describe("validateVerdict", () => {
  it("accepts a verdict with no note", () => {
    expect(validateVerdict({ verdict: "dismissed" })).toEqual({ verdict: "dismissed", note: null });
  });

  it("trims a note, and treats a blank one as absent", () => {
    expect(validateVerdict({ verdict: "fixed", note: "  added to the lexicon " })).toEqual({
      verdict: "fixed",
      note: "added to the lexicon",
    });
    expect(validateVerdict({ verdict: "fixed", note: "   " }).note).toBe(null);
  });

  it("names what it rejected", () => {
    expect(() => validateVerdict({ verdict: "maybe" })).toThrow(IssueError);
    expect(() => validateVerdict({ verdict: "maybe" })).toThrow(/open, fixed, dismissed/);
    expect(() => validateVerdict({ verdict: "open", note: "x".repeat(501) })).toThrow(/too long/);
    expect(() => validateVerdict("open")).toThrow(IssueError);
  });
});
