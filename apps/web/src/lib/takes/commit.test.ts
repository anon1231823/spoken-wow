/**
 * Committing a take: against a real Postgres and a real directory, deliberately.
 *
 * What commitTake promises is about things outside the code -- that no bytes are ever
 * overwritten before they have a copy elsewhere, and that the schema's one-live-take index
 * holds -- so a mock would test that the code calls what the code calls.
 *
 * Quests paths are used because they can be pointed at a temporary directory; the function
 * takes the section as an argument and nothing in it depends on which.
 *
 * Needs DATABASE_URL and migrations applied:
 *   deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "takes-commit-int-"));
process.env.SPOKEN_QUESTS_AUDIO = path.join(root, "audio");
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { commitTake } = await import("./commit");
const { archiveName } = await import("./bytes");
const { listTakes } = await import("./store");

/** A file no other run will collide with, so this can share a database with anything else. */
let file: string;

const store = () => path.join(root, "audio", file);
const history = () =>
  path.join(root, "audio-history", path.dirname(file), path.basename(file, ".mp3"));

function take(text: string, fields: Partial<Parameters<typeof commitTake>[3]> = {}) {
  return commitTake("quests", file, Buffer.from(text), {
    lineId: "g:commit-test",
    voice: "dwarf-male",
    modelId: "eleven_v3",
    seed: 7,
    characters: text.length,
    credits: 3,
    settings: { stability: 0.5 },
    ...fields,
  });
}

/** Every name in the file's history directory, sorted. */
function archived(): string[] {
  return fs.existsSync(history()) ? fs.readdirSync(history()).sort() : [];
}

beforeAll(async () => {
  try {
    await db().query(`select "archiveFile" from take limit 1`);
  } catch (error) {
    throw new Error(
      'commit.test.ts needs a migrated database. Run: deploy/web/bin/migrate.sh "$PWD/apps/web"\n' +
        String(error),
    );
  }
});

beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}commit.mp3`;
});

afterEach(async () => {
  await db().query(`delete from "take" where "file" = $1`, [file]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("the first take of a line", () => {
  it("is version 1, archived under a name carrying its hash, and copied to the store", async () => {
    const committed = await take("first");

    expect(committed.version).toBe(1);
    expect(committed.archiveFile).toBe(archiveName(1, Buffer.from("first")));
    expect(archived()).toEqual([committed.archiveFile]);
    expect(fs.readFileSync(store(), "utf8")).toBe("first");

    const [row] = await listTakes("quests", file);
    expect(row).toMatchObject({ version: 1, isCurrent: true, origin: "generated" });
    expect(row.archiveFile).toBe(committed.archiveFile);
  });

  it("records what the take was made with, so it can be reproduced", async () => {
    await take("first");

    const { rows } = await db().query(
      `select "voice", "modelId", "seed"::int, "characters", "credits", "settings"
         from "take" where "file" = $1`,
      [file],
    );
    expect(rows[0]).toEqual({
      voice: "dwarf-male",
      modelId: "eleven_v3",
      seed: 7,
      characters: 5,
      credits: 3,
      settings: { stability: 0.5 },
    });
  });
});

describe("re-rolling", () => {
  it("keeps every take in the archive, each under its own name", async () => {
    for (const text of ["one", "two", "three"]) await take(text);

    expect(archived()).toEqual(
      [archiveName(1, Buffer.from("one")), archiveName(2, Buffer.from("two")),
        archiveName(3, Buffer.from("three"))].sort(),
    );
    expect(fs.readFileSync(store(), "utf8")).toBe("three");

    const takes = await listTakes("quests", file);
    expect(takes.map((t) => t.version)).toEqual([3, 2, 1]);
    expect(takes.filter((t) => t.isCurrent).map((t) => t.version)).toEqual([3]);
  });

  it("never collides, even when two takes sound identical", async () => {
    // Same bytes, same content id -- but the version in the name keeps them apart, and the
    // first take's file is never rewritten with anything but what it already holds.
    await take("same");
    await take("same");

    expect(archived()).toEqual(
      [archiveName(1, Buffer.from("same")), archiveName(2, Buffer.from("same"))].sort(),
    );
  });
});

describe("a clip in the store that no row describes", () => {
  it("becomes a take of its own, rather than being refused or overwritten", async () => {
    // A crash between writing the store and recording the row, an rsync, a restored
    // database. The clip is kept, recorded, and can be restored like any other.
    fs.mkdirSync(path.dirname(store()), { recursive: true });
    fs.writeFileSync(store(), "nobody recorded this");

    const committed = await take("new");

    const takes = await listTakes("quests", file);
    expect(takes.map((t) => [t.version, t.origin, t.isCurrent])).toEqual([
      [2, "generated", true],
      [1, "imported", false],
    ]);
    expect(committed.version).toBe(2);
    expect(
      fs.readFileSync(path.join(history(), takes[1].archiveFile!), "utf8"),
    ).toBe("nobody recorded this");
    expect(fs.readFileSync(store(), "utf8")).toBe("new");
  });
});

describe("a live take that was never archived", () => {
  it("is archived under its own version before it is replaced, and its row says where", async () => {
    // Audio the CLI narrated before the app kept records: a row, a store file, no copy.
    fs.mkdirSync(path.dirname(store()), { recursive: true });
    fs.writeFileSync(store(), "narrated by the cli");
    await db().query(
      `insert into "take" ("source", "lang", "file", "lineId", "version", "isCurrent",
                           "origin", "bytes")
       values ('quests', 'enUS', $1, 'g:commit-test', 1, true, 'imported', 19)`,
      [file],
    );

    await take("re-rolled");

    const takes = await listTakes("quests", file);
    expect(takes.map((t) => t.version)).toEqual([2, 1]);
    expect(takes[1].archiveFile).toBe(archiveName(1, Buffer.from("narrated by the cli")));
    expect(fs.readFileSync(path.join(history(), takes[1].archiveFile!), "utf8")).toBe(
      "narrated by the cli",
    );
  });
});

describe("a store that fell behind its rows", () => {
  it("loses nothing: the stale clip is already archived under the take it belongs to", async () => {
    // The state a crash between recording a row and writing the store leaves: v2 is live
    // and archived, but the store still holds v1. The next commit must neither lose v1
    // nor mistake it for an unrecorded clip.
    await take("one");
    await take("two");
    fs.writeFileSync(store(), "one");

    await take("three");

    const takes = await listTakes("quests", file);
    expect(takes.map((t) => [t.version, t.origin])).toEqual([
      [3, "generated"],
      [2, "generated"],
      [1, "generated"],
    ]);
  });
});
