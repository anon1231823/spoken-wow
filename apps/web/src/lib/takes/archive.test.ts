/**
 * What an archived take is called, which is a naming rule and not a question about disk.
 *
 * The rule differs per section and both spellings stay readable forever, because archived
 * audio is never renamed. Pinned here because getting it wrong is silent: a restore would
 * look for a name nothing wrote.
 */
import { describe, expect, it } from "vitest";

import { archiveNameFor, sortedArchiveNames, versionInName } from "./archive";

describe("reading a history filename", () => {
  it("reads both namings, because both are on disk and neither is renamed", () => {
    // Quests wrote `3.mp3`; zones, books and everything cut from now on write `v3.mp3`.
    expect(versionInName("3.mp3")).toBe(3);
    expect(versionInName("v3.mp3")).toBe(3);
  });

  it("keeps version 0, which is the take that predates the app and is never pruned", () => {
    expect(versionInName("0.mp3")).toBe(0);
  });

  it("refuses anything else rather than reading a number out of it", () => {
    expect(versionInName("v3.part")).toBe(null);
    expect(versionInName("razor-hill.mp3")).toBe(null);
    expect(versionInName("v-1.mp3")).toBe(null);
    expect(versionInName("")).toBe(null);
  });

  it("sorts numerically, not by name: v10 is after v9", () => {
    expect(sortedArchiveNames(["v10.mp3", "v9.mp3", "notes.txt", "v1.mp3"])).toEqual([
      "v1.mp3",
      "v9.mp3",
      "v10.mp3",
    ]);
  });

  it("names a take after its own version, the way its section spells it", () => {
    // Quests has named archives by version since before the column existed; renaming 9,000
    // files to match the other two would be renaming irreplaceable audio to tidy a spelling.
    expect(archiveNameFor("quests", 4)).toBe("4.mp3");
    expect(archiveNameFor("zones", 4)).toBe("v4.mp3");
    expect(archiveNameFor("books", 0)).toBe("v0.mp3");
  });
});
