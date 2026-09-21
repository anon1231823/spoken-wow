/**
 * Against a real Postgres, deliberately, for the reason history.test.ts gives.
 *
 * What this module is for is an invariant the schema owns: `take_current_idx` allows
 * exactly one live take per (source, lang, file). A mocked database would test that the
 * code runs the statements the code runs, which is not a test -- the thing worth pinning is
 * that the pair of updates cannot leave a file with two live takes or none.
 *
 * Needs DATABASE_URL and migrations applied:
 *   docker compose up -d postgres && deploy/web/bin/migrate.sh "$PWD/apps/web"
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "takes-store-int-"));
process.env.SPOKEN_QUESTS_AUDIO = path.join(root, "audio");
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { listTakes, setLiveTake, takePath } = await import(
  "./store"
);

/** A file no other run will collide with, so this can share a database with anything else. */
let file: string;

/** Rows only: what the bytes are, without pretending any exist yet. */
async function record(version: number, isCurrent = false, archiveFile: string | null = null) {
  await db().query(
    `insert into "take"
       ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "bytes",
        "archiveFile")
     values ('quests', 'enUS', $1, 'g:test', $2, $3, 'generated', 1, $4)`,
    [file, version, isCurrent, archiveFile],
  );
}

beforeAll(async () => {
  try {
    await db().query(`select "archiveFile" from take limit 1`);
  } catch (error) {
    throw new Error(
      "store.test.ts needs a migrated database (migration 0031). Run:\n" +
        '  deploy/web/bin/migrate.sh "$PWD/apps/web"\n' +
        String(error),
    );
  }
});

beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}test.mp3`;
});

afterEach(async () => {
  await db().query(`delete from "take" where "file" = $1`, [file]);
});

afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

describe("listing takes", () => {
  it("returns them newest first, which is the order the panel reads in", async () => {
    await record(1);
    await record(2);
    await record(3, true);

    expect((await listTakes("quests", file)).map((take) => take.version)).toEqual([3, 2, 1]);
  });

  it("answers for a file with no takes at all rather than throwing", async () => {
    expect(await listTakes("quests", file)).toEqual([]);
  });
});

describe("finding a take's bytes", () => {
  const stem = () => path.basename(file, ".mp3");

  it("believes the name a take recorded for itself", async () => {
    await record(3, false, "v3-1a2b3c4d.mp3");
    await record(4, true);

    expect(await takePath("quests", file, 3)).toEqual({
      kind: "file",
      path: path.join(root, "audio-history", "gossip", stem(), "v3-1a2b3c4d.mp3"),
    });
  });

  it("puts the live take in the store, which is where its bytes actually are", async () => {
    // A take can be live without ever having been archived: audio narrated before this app
    // kept records has one row and one file, in the store. commitTake makes the archived
    // copy at the moment a re-roll is about to overwrite it, and not before.
    await record(1, true);

    expect(await takePath("quests", file, 1)).toEqual({
      kind: "file",
      path: path.join(root, "audio", file),
    });
  });

  it("says a clip was not kept, rather than guessing a name for it", async () => {
    // This used to fall back to the section's naming rule. For zones and books that rule
    // named clips by overwrite position, not version, so the guess could land on a real
    // file holding a different take.
    await record(2);
    await record(3, true);

    expect(await takePath("quests", file, 2)).toEqual({ kind: "gone" });
  });

  it("says when a version was never recorded", async () => {
    await record(1, true);

    expect(await takePath("quests", file, 9)).toEqual({ kind: "none" });
  });
});

describe("moving the live flag", () => {
  it("leaves exactly one live take, which is the whole point of the index", async () => {
    await record(1);
    await record(2, true);

    await setLiveTake("quests", file, 1);

    const live = (await listTakes("quests", file)).filter((take) => take.isCurrent);
    expect(live.map((take) => take.version)).toEqual([1]);
  });

  it("writes no new row: a restore says which take is right, it does not make one", async () => {
    await record(1);
    await record(2, true);

    await setLiveTake("quests", file, 1);

    expect(await listTakes("quests", file)).toHaveLength(2);
  });

  it("refuses a version that was never recorded, and leaves the live one alone", async () => {
    await record(1, true);

    await expect(setLiveTake("quests", file, 9)).rejects.toThrow(/no version 9/);

    const live = (await listTakes("quests", file)).filter((take) => take.isCurrent);
    expect(live.map((take) => take.version)).toEqual([1]);
  });
});
