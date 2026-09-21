import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-history-"));
const AUDIO = path.join(root, "audio");
const HISTORY = path.join(root, "audio-history");

// paths.ts reads the environment at import time, so this has to be set before the module
// graph is pulled in - hence the dynamic import below rather than a top-level one.
process.env.SPOKEN_QUESTS_AUDIO = AUDIO;
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = HISTORY;

const { historyDir, storePath } = await import("./archive");

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
    expect(historyDir("quests/5-accept.mp3")).toBe(path.join(HISTORY, "quests", "5-accept"));
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
});
