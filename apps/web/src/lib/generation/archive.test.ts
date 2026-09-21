import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-history-"));
const AUDIO = path.join(root, "audio");
const HISTORY = path.join(root, "audio-history");

// paths.ts reads the environment at import time, so this has to be set before the module
// graph is pulled in - hence the dynamic import below rather than a top-level one.
process.env.SPOKEN_QUESTS_AUDIO = AUDIO;
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = HISTORY;

const {
  archiveStoreFile,
  historyDir,
  storeFileBytes,
  storeFileExists,
  storePath,
  versionPath,
  writeStoreFile,
} = await import("./archive");

const FILE = "gossip/31ab172e1a375db1c9157d594eb608d9.mp3";

beforeEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(AUDIO, "gossip"), { recursive: true });
  fs.mkdirSync(path.join(AUDIO, "quests"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("paths", () => {
  it("puts a file's takes in their own directory, one level deeper than the store", () => {
    expect(historyDir(FILE)).toBe(
      path.join(HISTORY, "gossip", "31ab172e1a375db1c9157d594eb608d9"),
    );
    expect(versionPath("quests/5-accept.mp3", 3)).toBe(
      path.join(HISTORY, "quests", "5-accept", "3.mp3"),
    );
  });

  // History must not live inside audio/, or readStoreIndex would count old takes as store
  // files and `make push` would rsync them as if they were the store.
  it("keeps history outside the store", () => {
    expect(historyDir(FILE).startsWith(AUDIO + path.sep)).toBe(false);
  });

  it("refuses anything that is not a store-relative mp3", () => {
    for (const bad of [
      "../etc/passwd",
      "gossip/../../etc/passwd.mp3",
      "/absolute/x.mp3",
      "sounds/x.mp3",
      "gossip/x.wav",
      "gossip/sub/x.mp3",
    ]) {
      expect(() => storePath(bad)).toThrow(/unsafe store path/);
      expect(() => historyDir(bad)).toThrow(/unsafe store path/);
    }
  });

  it("refuses a version that is not a whole non-negative number", () => {
    for (const bad of [-1, 1.5, NaN, Infinity]) {
      expect(() => versionPath(FILE, bad)).toThrow(/bad version/);
    }
  });
});

describe("writeStoreFile", () => {
  it("writes into the store and leaves no partial behind", async () => {
    await writeStoreFile(FILE, Buffer.from("take one"));

    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("take one");
    expect(fs.readdirSync(path.join(AUDIO, "gossip"))).toEqual([
      "31ab172e1a375db1c9157d594eb608d9.mp3",
    ]);
  });

  it("overwrites in place, so the store keeps one file per line", async () => {
    await writeStoreFile(FILE, Buffer.from("one"));
    await writeStoreFile(FILE, Buffer.from("two"));
    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("two");
    expect(fs.readdirSync(path.join(AUDIO, "gossip"))).toHaveLength(1);
  });

  // A failed write must not leave a .part where a later readdir could trip over it.
  it("cleans up the partial when the rename fails", async () => {
    await writeStoreFile(FILE, Buffer.from("first"));
    const rename = vi.spyOn(fsp, "rename").mockRejectedValueOnce(new Error("disk full"));

    await expect(writeStoreFile(FILE, Buffer.from("second"))).rejects.toThrow("disk full");
    rename.mockRestore();

    expect(fs.readdirSync(path.join(AUDIO, "gossip"))).toEqual([
      "31ab172e1a375db1c9157d594eb608d9.mp3",
    ]);
    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("first");
  });
});

describe("archiveStoreFile", () => {
  it("copies the store file into history and reports its size", async () => {
    await writeStoreFile(FILE, Buffer.from("the first take"));
    const bytes = await archiveStoreFile(FILE, 1);

    expect(bytes).toBe(14);
    expect(fs.readFileSync(versionPath(FILE, 1), "utf8")).toBe("the first take");
    // Archiving copies; it must not move, or the line would go silent.
    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("the first take");
  });

  it("fails rather than recording an empty take when the store file is absent", async () => {
    await expect(archiveStoreFile(FILE, 1)).rejects.toThrow();
    expect(fs.existsSync(historyDir(FILE))).toBe(true);
    expect(fs.readdirSync(historyDir(FILE))).toEqual([]);
  });

  it("refuses version 0, which no longer means anything", async () => {
    // It used to mean "the take that predates the app". A line is either generated or it
    // is not, and its first generation is version 1.
    await writeStoreFile(FILE, Buffer.from("x"));
    await expect(archiveStoreFile(FILE, 0)).rejects.toThrow("bad version 0");
  });
});

describe("storeFileExists and storeFileBytes", () => {
  it("report a gap rather than throwing", async () => {
    expect(await storeFileExists(FILE)).toBe(false);
    expect(await storeFileBytes(FILE)).toBeNull();
  });

  it("report a present file", async () => {
    await writeStoreFile(FILE, Buffer.from("abc"));
    expect(await storeFileExists(FILE)).toBe(true);
    expect(await storeFileBytes(FILE)).toBe(3);
  });
});
