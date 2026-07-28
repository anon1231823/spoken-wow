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
process.env.VOICEOVER_AUDIO = path.join(root, "audio");
process.env.VOICEOVER_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { storePath, versionPath, versionsOnDisk, writeStoreFile } = await import("./archive");
const { commitVersion, historyOf, prune, restoreVersion } = await import("./history");
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
    voiceId: "voice-abc",
    modelId: "eleven_multilingual_v2",
    seed: 1163733943,
    characters: 42,
    credits: 23,
    settings: { ...SETTINGS },
    createdBy: null as unknown as string,
    ...overrides,
  });
}

beforeAll(async () => {
  try {
    await db().query("select 1 from voiceline_version limit 1");
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
  await db().query(`delete from "voiceline_version" where "file" = $1`, [file]);
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

describe("pruning", () => {
  it("keeps version 0 and the newest four, dropping rows and files together", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));
    for (let i = 0; i < 6; i++) await take({ data: Buffer.from(`take ${i}`) });

    expect(await versionsOnDisk(file)).toEqual([0, 3, 4, 5, 6]);
    expect((await listVersions(file)).map((v) => v.version)).toEqual([6, 5, 4, 3, 0]);

    // The original survives six re-rolls. A flat "newest five" would have lost it.
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe("inherited");
  });

  it("never reissues a pruned version number", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));
    for (let i = 0; i < 6; i++) await take();

    const next = await take();
    expect(next.version).toBe(7);
    expect(await versionsOnDisk(file)).toEqual([0, 4, 5, 6, 7]);
  });

  // Driven by what is on disk, so it never tries to delete a file that is not there. A row
  // whose audio has gone survives as an unplayable record rather than being tidied away:
  // someone else's rsync should not silently erase the fact that a take existed, and
  // historyOf and restoreVersion both already refuse to offer it.
  it("leaves a hand-deleted take recorded but unplayable", async () => {
    await take();
    await take();
    fs.rmSync(versionPath(file, 0));

    await prune(file);

    expect((await listVersions(file)).map((v) => v.version)).toEqual([1, 0]);
    expect(await historyOf(file)).toMatchObject([{ version: 1, playable: true }, { version: 0, playable: false }]);
  });
});

describe("restoreVersion", () => {
  it("puts the original back and makes it current", async () => {
    await writeStoreFile(file, Buffer.from("inherited"));
    await take({ data: Buffer.from("re-rolled") });

    const result = await restoreVersion(file, 0);

    expect(result.version).toBe(0);
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("inherited");

    const versions = await listVersions(file);
    expect(versions.filter((v) => v.isCurrent).map((v) => v.version)).toEqual([0]);
  });

  // History is what happened, not a log of what was looked at. A restore that invented a
  // version would make "restore v0" produce a v3 that is not the original either.
  it("does not invent a new version", async () => {
    await take();
    await take();
    await restoreVersion(file, 0);

    expect((await listVersions(file)).map((v) => v.version)).toEqual([1, 0]);
  });

  it("archives inherited audio first, even when restoring", async () => {
    // The store holds audio this app never recorded - a file pushed by rsync after the
    // history was made. Restoring over it without archiving would destroy it.
    await take();
    await writeStoreFile(file, Buffer.from("pushed by hand, never recorded"));
    await db().query(`delete from "voiceline_version" where "file" = $1`, [file]);

    fs.rmSync(versionPath(file, 0));
    await writeStoreFile(file, Buffer.from("current"));
    await take({ data: Buffer.from("newest") });

    expect((await listVersions(file)).some((v) => v.origin === "inherited")).toBe(true);
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe("current");
  });

  it("refuses a version that was never recorded", async () => {
    await take();
    await expect(restoreVersion(file, 9)).rejects.toThrow(/no version 9/);
  });

  it("refuses a version whose audio has gone, rather than half-restoring", async () => {
    await take();
    await take();
    fs.rmSync(versionPath(file, 0));

    await expect(restoreVersion(file, 0)).rejects.toThrow(/audio is missing/);
    // The live take is untouched: nothing was archived and nothing was overwritten.
    expect(fs.readFileSync(storePath(file), "utf8")).toBe("generated take");
  });
});

describe("historyOf", () => {
  it("marks a take whose audio has gone as unplayable rather than hiding it", async () => {
    await take();
    await take();
    fs.rmSync(versionPath(file, 0));

    const history = await historyOf(file);
    expect(history.map((v) => [v.version, v.playable])).toEqual([
      [1, true],
      [0, false],
    ]);
  });

  it("is empty for a line this app has never written", async () => {
    expect(await historyOf(file)).toEqual([]);
  });
});

/**
 * The database is not the only record of what exists.
 *
 * A restored backup, a hand-run delete, or a fresh database pointed at an existing
 * audio-history all leave takes on disk with no rows describing them. Trusting the table
 * alone would archive the *current* take as version 0 - overwriting the real original with
 * a re-roll, permanently. This is how that was actually discovered: a test cleared the rows,
 * a later regeneration ran, and version 0 stopped being the original.
 */
describe("when the rows are gone but the takes are not", () => {
  it("does not overwrite version 0 with whatever is current", async () => {
    await writeStoreFile(file, Buffer.from("the irreplaceable original"));
    await take({ data: Buffer.from("a re-roll") });

    // The rows vanish; the audio does not.
    await db().query(`delete from "voiceline_version" where "file" = $1`, [file]);

    const result = await take({ data: Buffer.from("another re-roll") });

    expect(result.archivedInherited).toBe(false);
    expect(fs.readFileSync(versionPath(file, 0), "utf8")).toBe("the irreplaceable original");
  });

  it("does not reissue a version number that already names a take", async () => {
    await writeStoreFile(file, Buffer.from("original"));
    await take({ data: Buffer.from("first") });
    await take({ data: Buffer.from("second") });
    expect(await versionsOnDisk(file)).toEqual([0, 1, 2]);

    await db().query(`delete from "voiceline_version" where "file" = $1`, [file]);

    const result = await take({ data: Buffer.from("third") });

    expect(result.version).toBe(3);
    expect(fs.readFileSync(versionPath(file, 1), "utf8")).toBe("first");
    expect(fs.readFileSync(versionPath(file, 2), "utf8")).toBe("second");
    expect(fs.readFileSync(versionPath(file, 3), "utf8")).toBe("third");
  });
});
