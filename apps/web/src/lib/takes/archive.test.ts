/**
 * The one question in the take layer whose wrong answer is silent.
 *
 * A restore that resolves to the wrong archived clip writes a different line into the store
 * and the addon plays it; nothing errors, and the person who finds out is a player. So the
 * pairing rule is pinned here, including the cases where it must refuse to answer.
 */
import { describe, expect, it } from "vitest";

import { archiveNameFor, resolveArchive, sortedArchiveNames, versionInName } from "./archive";

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

  it("names a new take after its own version, in every section", () => {
    expect(archiveNameFor(4)).toBe("v4.mp3");
  });
});

describe("resolving a take to its bytes", () => {
  it("believes a take that records its own file", () => {
    const takes = [{ version: 7, archiveFile: "v7.mp3" }];
    expect(resolveArchive(takes, ["v7.mp3"]).get(7)).toBe("v7.mp3");
  });

  it("matches a quests take by number, where the archive is named by version", () => {
    const takes = [{ version: 0 }, { version: 1 }, { version: 2, isCurrent: true }];
    const found = resolveArchive(takes, ["0.mp3", "1.mp3", "2.mp3"]);
    expect(found.get(0)).toBe("0.mp3");
    expect(found.get(2)).toBe("2.mp3");
  });

  it("pairs legacy zones names in order, oldest clip to oldest superseded take", () => {
    // Three takes, the newest live. Two clips were displaced, in the order they were cut.
    const takes = [{ version: 1 }, { version: 2 }, { version: 3, isCurrent: true }];
    const found = resolveArchive(takes, ["v1.mp3", "v2.mp3"]);
    expect(found.get(1)).toBe("v1.mp3");
    expect(found.get(2)).toBe("v2.mp3");
    // The live take has displaced nothing, so it is not in the archive at all.
    expect(found.has(3)).toBe(false);
  });

  it("pairs an inherited clip too, which is the extra one at the front", () => {
    // A file that existed before the app: the first cut displaced it, so there is one more
    // archived clip than there are superseded takes' own recordings.
    const takes = [{ version: 0 }, { version: 1 }, { version: 2, isCurrent: true }];
    const found = resolveArchive(takes, ["v1.mp3", "v2.mp3"]);
    expect(found.get(0)).toBe("v1.mp3");
    expect(found.get(1)).toBe("v2.mp3");
  });

  it("refuses to pair at all when the counts disagree, rather than guessing at an offset", () => {
    // Two superseded takes, one clip. Somebody deleted one by hand, or an rsync did. Which
    // of the two survived is unknowable from here, and the name is no help: under this
    // numbering `v1.mp3` is "the first clip displaced", not "take 1". So nothing resolves,
    // and both takes are shown as unplayable rather than one of them pointing at bytes
    // that may belong to the other.
    const takes = [{ version: 1 }, { version: 2 }, { version: 3, isCurrent: true }];
    expect(resolveArchive(takes, ["v1.mp3"]).size).toBe(0);
  });

  it("resolves nothing for a file with no history at all", () => {
    expect(resolveArchive([{ version: 1, isCurrent: true }], []).size).toBe(0);
  });

  it("ignores an archiveFile the directory no longer holds", () => {
    // The row says v4.mp3 and the bytes are gone. Falling through to positional pairing
    // would hand this take somebody else's clip; it has to come back unresolved.
    const takes = [{ version: 4, archiveFile: "v4.mp3" }, { version: 5, isCurrent: true }];
    expect(resolveArchive(takes, ["v9.mp3", "v10.mp3"]).has(4)).toBe(false);
  });
});
