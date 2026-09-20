/**
 * What a restore must not do: lose a file, or invent a take.
 *
 * Against a real Postgres and a real directory, because both halves of the claim are
 * about things outside the code -- the bytes on disk and the partial unique index that
 * allows one live take per file.
 *
 * The failure this pins used to be real on two of the three sections: restoring renamed
 * the archived clip back into the store, so undoing a re-roll destroyed the only archived
 * copy of the take being restored. Undo once and it could never be found again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, it } from "vitest";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "restore-proof-"));
process.env.SPOKEN_QUESTS_AUDIO = path.join(root, "audio");
process.env.SPOKEN_QUESTS_AUDIO_HISTORY = path.join(root, "audio-history");

const { closeDb, db } = await import("@/lib/db");
const { writeStoreFile, storePath } = await import("@/lib/generation/archive");
const { commitVersion } = await import("@/lib/generation/history");
const { restoreTake } = await import("@/lib/takes/restore");
const { listTakes } = await import("@/lib/takes/store");

let file: string;
beforeEach(() => {
  file = `gossip/${Math.random().toString(16).slice(2).padEnd(12, "0")}proof.mp3`;
  fs.mkdirSync(path.join(root, "audio", "gossip"), { recursive: true });
});
afterAll(async () => {
  await db().query(`delete from "take" where "file" like '%proof.mp3'`);
  fs.rmSync(root, { recursive: true, force: true });
  await closeDb();
});

function take(text: string) {
  return commitVersion({
    file, data: Buffer.from(text), lineId: "g:proof", voice: "dwarf-male",
    narratorVoice: null, voiceId: "v", modelId: "m", seed: 1, characters: 1,
    credits: 1, settings: { stability: 0.5 }, spokenText: text,
    dictionaryVersion: null, createdBy: null as unknown as string,
  });
}

it("puts a take back without losing a file or inventing a take", async () => {
  await writeStoreFile(file, Buffer.from("inherited"));
  await take("take one");
  await take("take two");

  const dir = path.join(root, "audio-history", "gossip", path.basename(file, ".mp3"));
  const before = fs.readdirSync(dir).sort();
  const rowsBefore = await listTakes("quests", file);

  await restoreTake("quests", file, 0);

  expect(fs.readdirSync(dir).sort()).toEqual(before);
  expect(fs.readFileSync(storePath(file), "utf8")).toBe("inherited");
  const rowsAfter = await listTakes("quests", file);
  expect(rowsAfter).toHaveLength(rowsBefore.length);
  expect(rowsAfter.filter((r) => r.isCurrent).map((r) => r.version)).toEqual([0]);

  // Twice over, which is the case that used to eat the archive entry: the second restore
  // has to find the take the first one moved away from.
  await restoreTake("quests", file, 2);
  expect(fs.readdirSync(dir).sort()).toEqual(before);
  expect(fs.readFileSync(storePath(file), "utf8")).toBe("take two");
});
