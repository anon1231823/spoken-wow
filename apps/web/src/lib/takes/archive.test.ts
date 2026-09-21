/**
 * What an archived take is called, which is a naming rule and not a question about disk.
 *
 * The rule differs per section and both spellings stay readable forever, because archived
 * audio is never renamed. Pinned here because getting it wrong is silent: a restore would
 * look for a name nothing wrote.
 */
import { describe, expect, it } from "vitest";

import { archiveNameFor } from "./archive";

describe("naming an archived take", () => {
  it("names a take after its own version, the way its section spells it", () => {
    // Quests has named archives by version since before the column existed; renaming 9,000
    // files to match the other two would be renaming irreplaceable audio to tidy a spelling.
    expect(archiveNameFor("quests", 4)).toBe("4.mp3");
    expect(archiveNameFor("zones", 4)).toBe("v4.mp3");
    expect(archiveNameFor("books", 4)).toBe("v4.mp3");
  });

  it("counts from one, because a line is either generated or it is not", () => {
    // There is no version 0. It used to mean "the take that predates the app", which was a
    // statement about the database rather than about the line: the audio was generated, by
    // the CLI, and that generation is version 1.
    expect(archiveNameFor("quests", 1)).toBe("1.mp3");
    expect(archiveNameFor("zones", 1)).toBe("v1.mp3");
  });
});
