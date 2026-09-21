/**
 * Against a real Postgres, deliberately.
 *
 * What history.ts is for is an ordering - archive what is in the store before anything
 * overwrites it - and the constraints that keep it honest live in the schema: one current
 * version per file, one row per (file, version). A mocked database would test that the code
 * calls the functions in the order the code calls them in, which is not a test.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/bin/migrate.sh "$PWD/web"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "voice-history-int-"));
process.env.SPOKEN_QUESTS_AUDIO = path.join(root, "audio");
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { historyDir, storePath, versionPath, writeStoreFile } = await import("./archive");
const { commitVersion } = await import("./history");
const { listVersions } = await import("./versions");

const SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
} as const;

/** A file name no other run will collide with, so tests can run against a shared database. */
let file: string;

function take(overrides: Partial<Parameters<typeof commitVersion>[0]> = {}) {
  return commitVersion({
    file,
    data: Buffer.from("generated take"),
    lineId: "g:31ab172e1a375db1c9157d594eb608d9",
    voice: "dwarf-male",
    narratorVoice: null,
    voiceId: "voice-abc",
    leadIn: false,
    leadInSec: null,
    modelId: "eleven_multilingual_v2",
    seed: 1163733943,
    characters: 42,
    credits: 23,
    settings: { ...SETTINGS },
    spokenText: "Meet me in Gnomeregan.",
    dictionaryVersion: "version-1",
    createdBy: null as unknown as string,
    ...overrides,
  });
}

beforeAll(async () => {
  try {
    await db().query("select 1 from take limit 1");
  } catch (error) {
    throw new Error(
      "history.test.ts needs a migrated database. Run:\n" +
        "  docker compose up -d postgres && deploy/bin/migrate.sh \"$PWD/web\"\n" +
        String(error),
    );
  }
});

beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}test.mp3`;
  fs.mkdirSync(path.join(root, "audio", "gossip"), { recursive: true });
});

afterEach(async () => {
  await db().query(`delete from "take" where "file" = $1`, [file]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

/** The take numbers in a file's history directory, ascending. Test-only. */
function archived(name: string): number[] {
  if (!fs.existsSync(historyDir(name))) return [];
  return fs
    .readdirSync(historyDir(name))
    .filter((entry) => /^\d+\.mp3$/.test(entry))
    .map((entry) => Number(entry.slice(0, -4)))
    .sort((a, b) => a - b);
}

describe("audio in the store that no take row describes", () => {
  it("refuses to generate over it rather than destroying a take nothing can name", async () => {
    // This is the whole of what version 0 used to be for: the app found a clip it had no
    // record of and invented a number to archive it under. A version number is the table's
    // to issue, so the honest answer is to stop. Seeding the rows is a one-off that has
    // already happened for every clip in the store.
    await writeStoreFile(file, Buffer.from("audio nothing recorded"));

    await expect(take()).rejects.toThrow(/no take row/);

    // Untouched: the clip is still there and still the only copy of itself.
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("audio nothing recorded");
    expect(archived(file)).toEqual([]);
  });
});

describe("the first take of a line", () => {
  it("is version 1, because there is no take before the first one", async () => {
    const result = await take();

    expect(result.archivedLive).toBe(false);
    expect(result.version).toBe(1);
    expect(archived(file)).toEqual([1]);
    expect((await listVersions(file))[0].origin).toBe("generated");
  });
});

describe("re-rolling a line", () => {
  it("archives the take being replaced under its own version, every time", async () => {
    // Not "once, the first time". Every take is copied out before the next lands on it,
    // and a take that was already archived when it was cut is simply copied over itself.
    await take({ data: Buffer.from("first") });

    expect((await take({ data: Buffer.from("second") })).archivedLive).toBe(true);
    expect((await take({ data: Buffer.from("third") })).archivedLive).toBe(true);

    expect(archived(file)).toEqual([1, 2, 3]);
    expect(fs.readFileSync(versionPath(file, 1), "utf8")).toBe("first");
    expect(fs.readFileSync(versionPath(file, 2), "utf8")).toBe("second");
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("third");
  });
});

describe("commitVersion", () => {
  it("records what the take was made with, so it can be reproduced", async () => {
    await take();

    const [version] = await listVersions(file);
    expect(version.origin).toBe("generated");
    expect(version.voice).toBe("dwarf-male");
    expect(version.voiceId).toBe("voice-abc");
    expect(version.modelId).toBe("eleven_multilingual_v2");
    expect(version.seed).toBe(1163733943);
    expect(version.characters).toBe(42);
    expect(version.settings).toEqual(SETTINGS);
  });

  it("marks exactly one version current, and it is the newest", async () => {
    await take();
    await take({ data: Buffer.from("second") });
    await take({ data: Buffer.from("third") });

    const versions = await listVersions(file);
    expect(versions.filter((v) => v.isCurrent).map((v) => v.version)).toEqual([3]);
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("third");
  });

  it("keeps the store and the newest archive byte-identical", async () => {
    const result = await take({ data: Buffer.from("the take that is live") });

    expect(fs.readFileSync(storePath(file), "utf8")).toBe("the take that is live");
    expect(fs.readFileSync(versionPath(file, result.version), "utf8")).toBe(
      "the take that is live",
    );
  });
});

describe("keeping every take", () => {
  it("keeps all of them, however many re-rolls there have been", async () => {
    // This used to keep the newest five and delete the rest, which meant the fifth re-roll
    // of a line destroyed a take somebody might want back -- and a re-roll is exactly when
    // they want it. Audio files are now kept; reclaiming space is a deliberate job for a
    // cleanup process, not a side effect of generating.
    for (let i = 0; i < 6; i++) await take({ data: Buffer.from(`take ${i}`) });

    expect(archived(file)).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await listVersions(file)).map((v) => v.version)).toEqual([6, 5, 4, 3, 2, 1]);

    expect(fs.readFileSync(versionPath(file, 1), "utf8")).toBe("take 0");
  });

  it("numbers past the highest used, so a number is never reissued", async () => {
    for (let i = 0; i < 6; i++) await take();

    expect((await take()).version).toBe(7);
  });

  // A row whose audio has gone survives as a record rather than being tidied away:
  // someone else's rsync should not silently erase the fact that a take existed. The row
  // is what the panel lists; that the bytes are missing is discovered by whoever plays or
  // restores it, not predicted by a directory listing while the page renders.
  it("leaves a hand-deleted take recorded", async () => {
    await take();
    await take();
    fs.rmSync(versionPath(file, 1));

    expect((await listVersions(file)).map((v) => v.version)).toEqual([2, 1]);
  });
});

describe("when the rows are gone but the takes are not", () => {
  it("stops, rather than reading the archive to work out what it lost", async () => {
    // This used to survive a wiped table by taking the highest number in the history
    // directory and carrying on -- which made the filesystem a second register of what
    // exists, and on a machine whose archive is mounted elsewhere it read as "no history"
    // and handed out a number already in use. The table is the record. A store file it
    // cannot account for stops the write instead, and nothing is overwritten or renumbered.
    await take({ data: Buffer.from("first") });
    await take({ data: Buffer.from("second") });

    await db().query(`delete from "take" where "file" = $1`, [file]);

    await expect(take({ data: Buffer.from("third") })).rejects.toThrow(/no take row/);

    expect(fs.readFileSync(versionPath(file, 1), "utf8")).toBe("first");
    expect(fs.readFileSync(versionPath(file, 2), "utf8")).toBe("second");
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("second");
  });
});
