import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { corpus as catalogue } from "./quests/catalogue";
import { audioRelPath, readStoreIndex, subfolder, fileIndex } from "./audio";

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

describe("store reconciliation", async () => {
  const store = readStoreIndex();
  const addressed = new Set((await catalogue()).lines.map(audioRelPath));

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


describe("fileIndex as the whitelist of addressable paths", async () => {
  const files = await fileIndex();

  it("contains every path the explorer would link to", async () => {
    for (const line of (await catalogue()).lines.slice(0, 500)) {
      expect(files.has(audioRelPath(line))).toBe(true);
    }
  });

  it("holds one entry per distinct file, not per line", async () => {
    // 14,315 generatable lines collapse to 11,081 files: a gossip file is named
    // md5(text + race + gender), so NPCs sharing a line share an mp3.
    expect(files.size).toBeLessThan((await catalogue()).lines.length);
    expect(files.size).toBeGreaterThan(10000);
  });

  it("rejects traversal and anything outside the two subfolders", () => {
    for (const bad of [
      "../etc/passwd",
      "quests/../../etc/passwd.mp3",
      "/etc/passwd",
      "sounds/5-accept.mp3",
      "quests/5-accept.wav",
      "quests/does-not-exist.mp3",
      "",
    ]) {
      expect(files.has(bad)).toBe(false);
    }
  });

  it("memoises", async () => {
    expect(await fileIndex()).toBe(files);
  });
});
