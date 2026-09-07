import { describe, expect, it } from "vitest";

import type { CorpusLine } from "@/lib/corpus";
import { scanCasings } from "./casings";

function line(text: string, generatable = true): CorpusLine {
  return { text, generatable, lineId: "x", voice: "v" } as unknown as CorpusLine;
}

describe("scanCasings", () => {
  /**
   * The whole reason this exists: a phoneme rule cannot be case-insensitive, so every
   * spelling the corpus uses needs its own rule. Missing one is a name mispronounced.
   */
  it("finds every spelling of a name", () => {
    const lines = [line("The tauren wait."), line("Tauren scouts."), line("TAUREN!")];
    expect(new Set(scanCasings(["tauren"], lines).tauren)).toEqual(
      new Set(["tauren", "Tauren", "TAUREN"]),
    );
  });

  // Most frequent first, so a truncated dictionary loses the rarest spelling rather than the
  // one that covers hundreds of lines.
  it("orders spellings by how often they occur", () => {
    const lines = [line("Tauren."), line("tauren tauren tauren.")];
    expect(scanCasings(["tauren"], lines).tauren).toEqual(["tauren", "Tauren"]);
  });

  it("returns an entry for every name asked for", () => {
    const casings = scanCasings(["tauren", "Xyzzy"], [line("The tauren wait.")]);
    expect(Object.keys(casings).sort()).toEqual(["Xyzzy", "tauren"]);
    expect(casings.Xyzzy).toEqual([]);
  });

  // The prefilter must not smuggle in a substring: "Caer" inside "Caern" is not a match, and
  // a rule for it would fire where no rule should.
  it("respects word boundaries", () => {
    expect(scanCasings(["Caer"], [line("The Caern is near.")]).Caer).toEqual([]);
  });

  it("skips lines that are never voiced", () => {
    expect(scanCasings(["tauren"], [line("The tauren wait.", false)]).tauren).toEqual([]);
  });

  // The pattern is global and therefore stateful; a forgotten lastIndex would make the second
  // occurrence in a line invisible.
  it("counts every occurrence in a line, not just the first", () => {
    expect(scanCasings(["Shaw"], [line("Shaw and Shaw and shaw.")]).Shaw).toEqual(["Shaw", "shaw"]);
  });

  it("handles apostrophes in a name", () => {
    const lines = [line("Aku'mai stirs."), line("The Aku'Mai cult.")];
    expect(new Set(scanCasings(["Aku'mai"], lines)["Aku'mai"])).toEqual(
      new Set(["Aku'mai", "Aku'Mai"]),
    );
  });
});
