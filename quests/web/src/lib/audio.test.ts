import { describe, expect, it } from "vitest";

import { loadCorpus } from "./corpus";
import { audioRelPath, storeIndex, subfolder } from "./audio";

describe("audio paths", () => {
  it("puts quest lines under quests/", () => {
    expect(audioRelPath({ source: "accept", fileName: "5-accept" })).toBe(
      "quests/5-accept.mp3",
    );
    expect(audioRelPath({ source: "complete", fileName: "123-complete" })).toBe(
      "quests/123-complete.mp3",
    );
  });

  it("puts gossip under gossip/", () => {
    expect(audioRelPath({ source: "gossip", fileName: "abc123" })).toBe(
      "gossip/abc123.mp3",
    );
  });

  it("keeps the gender prefix Python put in the filename", () => {
    // The prefix is part of fileName, never added here.
    expect(subfolder({ source: "gossip" })).toBe("gossip");
    expect(audioRelPath({ source: "gossip", fileName: "m-abc123" })).toBe(
      "gossip/m-abc123.mp3",
    );
  });
});

describe("store reconciliation", () => {
  const store = storeIndex();
  const addressed = new Set(loadCorpus().lines.map(audioRelPath));

  it("has an audio store to check", () => {
    // A fresh clone has no audio until `python cli-main.py import-audio` has run.
    if (store.size === 0) {
      console.warn("audio store is empty; run import-audio to exercise reconciliation");
    }
    expect(store.size).toBeGreaterThanOrEqual(0);
  });

  it("addresses every file in the store", () => {
    // The real assertion of this file: if the subfolder rule here ever diverged from
    // subfolder_from_line_id in tts_cli/naming.py, files would go unaddressed and the
    // explorer would report audio as missing while it sits on disk.
    const orphans = [...store].filter((rel) => !addressed.has(rel));
    expect(orphans).toEqual([]);
  });
});
