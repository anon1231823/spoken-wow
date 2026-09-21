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
const { storePath, versionPath, versionsOnDisk, writeStoreFile } = await import("./archive");
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

describe("the first regeneration of inherited audio", () => {
  it("archives what was there as version 0 before overwriting it", async () => {
    await writeStoreFile(file, Buffer.from("the audio this project inherited"));

    const result = await take();

    expect(result.archivedInherited).toBe(true);
    expect(result.version).toBe(1);

    // The original is recoverable, which is the entire point of the exercise.
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe(
      "the audio this project inherited",
    );
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("generated take");
  });

  it("records the inherited take as unreproducible rather than guessing", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));
    await take();

    const [, inherited] = await listVersions(file);
    expect(inherited.version).toBe(0);
    expect(inherited.origin).toBe("inherited");
    // Nothing recorded how it was made; claiming a model or a seed would suggest it could
    // be reproduced.
    expect(inherited.modelId).toBeNull();
    expect(inherited.seed).toBeNull();
    expect(inherited.settings).toBeNull();
    expect(inherited.bytes).toBe(9);
  });

  it("archives nothing when the line had no audio to begin with", async () => {
    const result = await take();

    expect(result.archivedInherited).toBe(false);
    expect(result.version).toBe(0);
    expect(await versionsOnDisk(file)).toEqual([0]);
    expect((await listVersions(file))[0].origin).toBe("generated");
  });

  it("archives only once, however many times the line is regenerated", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));

    expect((await take()).archivedInherited).toBe(true);
    expect((await take()).archivedInherited).toBe(false);
    expect((await take()).archivedInherited).toBe(false);

    expect(await versionsOnDisk(file)).toEqual([0, 1, 2, 3]);
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
    expect(versions.filter((v) => v.isCurrent).map((v) => v.version)).toEqual([2]);
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
    // This used to keep version 0 and the newest four and delete the rest, which meant the
    // fifth re-roll of a line destroyed a take somebody might want back -- and a re-roll is
    // exactly when they want it. Audio files are now kept; reclaiming space is a deliberate
    // job for a cleanup process, not a side effect of generating.
    await writeStoreFile(file, Buffer.from("inherited"));
    for (let i = 0; i < 6; i++) await take({ data: Buffer.from(`take ${i}`) });

    expect(await versionsOnDisk(file)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect((await listVersions(file)).map((v) => v.version)).toEqual([6, 5, 4, 3, 2, 1, 0]);

    // The original is still the one nothing can reproduce.
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe("inherited");
  });

  it("numbers past the highest used, so a number is never reissued", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));
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
    fs.rmSync(versionPath(file, 0));

    expect((await listVersions(file)).map((v) => v.version)).toEqual([1, 0]);
  });
});

describe("when the rows are gone but the takes are not", () => {
  it("does not overwrite version 0 with whatever is current", async () => {
    await writeStoreFile(file, Buffer.from("the irreplaceable original"));
    await take({ data: Buffer.from("a re-roll") });

    // The rows vanish; the audio does not.
    await db().query(`delete from "take" where "file" = $1`, [file]);

    const result = await take({ data: Buffer.from("another re-roll") });

    expect(result.archivedInherited).toBe(false);
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe("the irreplaceable original");
  });

  it("does not reissue a version number that already names a take", async () => {
    await writeStoreFile(file, Buffer.from("original"));
    await take({ data: Buffer.from("first") });
    await take({ data: Buffer.from("second") });
    expect(await versionsOnDisk(file)).toEqual([0, 1, 2]);

    await db().query(`delete from "take" where "file" = $1`, [file]);

    const result = await take({ data: Buffer.from("third") });

    expect(result.version).toBe(3);
    expect(fs.readFileSync(versionPath(file, 1), "utf8")).toBe("first");
    expect(fs.readFileSync(versionPath(file, 2), "utf8")).toBe("second");
    expect(fs.readFileSync(versionPath(file, 3), "utf8")).toBe("third");
  });
});
