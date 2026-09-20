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
  INHERITED_VERSION,
  restoreVersionFile,
  storeFileBytes,
  storeFileExists,
  storePath,
  versionPath,
  versionsOnDisk,
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
    await writeStoreFile(FILE, Buffer.from("inherited take"));
    const bytes = await archiveStoreFile(FILE, INHERITED_VERSION);

    expect(bytes).toBe(14);
    expect(fs.readFileSync(versionPath(FILE, 0), "utf8")).toBe("inherited take");
    // Archiving copies; it must not move, or the line would go silent.
    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("inherited take");
  });

  it("fails rather than recording an empty take when the store file is absent", async () => {
    await expect(archiveStoreFile(FILE, 0)).rejects.toThrow();
    expect(await versionsOnDisk(FILE)).toEqual([]);
  });
});

describe("restoreVersionFile", () => {
  it("puts an archived take back into the store", async () => {
    await writeStoreFile(FILE, Buffer.from("original"));
    await archiveStoreFile(FILE, 0);
    await writeStoreFile(FILE, Buffer.from("re-rolled"));

    const data = await restoreVersionFile(FILE, 0);

    expect(data.toString()).toBe("original");
    expect(fs.readFileSync(storePath(FILE), "utf8")).toBe("original");
    // The take restored from is still in history: restoring is not consuming.
    expect(fs.readFileSync(versionPath(FILE, 0), "utf8")).toBe("original");
  });
});

describe("versionsOnDisk", () => {
  it("is empty for a file nothing has touched", async () => {
    expect(await versionsOnDisk(FILE)).toEqual([]);
  });

  it("lists numerically, not lexically", async () => {
    fs.mkdirSync(historyDir(FILE), { recursive: true });
    for (const version of [0, 2, 10, 9]) {
      fs.writeFileSync(versionPath(FILE, version), "x");
    }
    expect(await versionsOnDisk(FILE)).toEqual([0, 2, 9, 10]);
  });

  it("ignores anything that is not a numbered take", async () => {
    fs.mkdirSync(historyDir(FILE), { recursive: true });
    fs.writeFileSync(versionPath(FILE, 1), "x");
    fs.writeFileSync(path.join(historyDir(FILE), "1.mp3.part"), "x");
    fs.writeFileSync(path.join(historyDir(FILE), "notes.txt"), "x");
    expect(await versionsOnDisk(FILE)).toEqual([1]);
  });
});

// The rule the user chose: version 0 pinned, plus the newest four. A flat "newest five"
// would lose the original on the fifth re-roll, and the original is the only take that
// cannot be remade.
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
