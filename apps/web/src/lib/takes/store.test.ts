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
const { archiveNameOf, listTakes, noteArchiveFile, setLiveTake, takeHistory } = await import(
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

function archive(name: string) {
  const dir = path.join(root, "audio-history", "gossip", path.basename(file, ".mp3"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), "x");
}

beforeAll(async () => {
  try {
    await db().query(`select "archiveFile" from take limit 1`);
  } catch (error) {
    throw new Error(
      "store.test.ts needs a migrated database (migration 0030). Run:\n" +
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
    await record(0);
    await record(1);
    await record(2, true);

    expect((await listTakes("quests", file)).map((take) => take.version)).toEqual([2, 1, 0]);
  });

  it("answers for a file with no takes at all rather than throwing", async () => {
    expect(await listTakes("quests", file)).toEqual([]);
  });
});

describe("what the history panel is told", () => {
  it("marks a take playable only when its bytes can be found", async () => {
    await record(0, false, "0.mp3");
    await record(1, true, "1.mp3");
    archive("0.mp3");

    const history = await takeHistory("quests", file);
    expect(history.find((take) => take.version === 0)).toMatchObject({
      playable: true,
      archiveFile: "0.mp3",
    });
    // The live take's bytes are in the store whether or not they are also archived, so it
    // is playable on its own terms.
    expect(history.find((take) => take.version === 1)).toMatchObject({ playable: true });
  });

  it("keeps a take whose audio is gone, and says it cannot be played", async () => {
    // Someone's rsync, or a hand-deleted directory. The row is still a true record that
    // the take existed, and hiding it would make the history quietly wrong instead of
    // visibly incomplete.
    await record(0, false, "0.mp3");
    await record(1, true, "1.mp3");

    const history = await takeHistory("quests", file);
    expect(history.find((take) => take.version === 0)).toMatchObject({ playable: false });
  });
});

describe("finding a take's bytes", () => {
  it("resolves a quests take by its version, which is what its archive is named", async () => {
    await record(3);
    await record(4, true);
    archive("3.mp3");

    expect(await archiveNameOf("quests", file, 3)).toBe("3.mp3");
  });

  it("answers null rather than guessing when the archive cannot be paired", async () => {
    // Two superseded takes, one clip, and the name says nothing about which: restoring
    // either would be a coin toss whose wrong outcome is a player hearing another line.
    await record(1);
    await record(2);
    await record(3, true);
    archive("v7.mp3");

    expect(await archiveNameOf("quests", file, 1)).toBe(null);
    expect(await archiveNameOf("quests", file, 2)).toBe(null);
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

describe("recording where a take's bytes went", () => {
  it("saves the name, so nothing has to be worked out for that take again", async () => {
    await record(5, true);

    await noteArchiveFile("quests", file, 5, "v5.mp3");

    expect((await listTakes("quests", file))[0].archiveFile).toBe("v5.mp3");
  });
});
