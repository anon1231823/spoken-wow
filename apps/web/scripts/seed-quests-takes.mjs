#!/usr/bin/env node
// Gives every clip the CLI narrated before this app kept records its take row: version 1,
// origin 'imported'.
//
//   cd apps/web && node scripts/seed-quests-takes.mjs --dry-run   # report, write nothing
//   cd apps/web && node scripts/seed-quests-takes.mjs             # insert the rows
//
// RUN ONCE, WHERE THE STORE IS, AND THEN DELETE THIS FILE. It is the one-off that makes the
// database true about a corpus generated before the database existed. Nothing in the app
// calls it, nothing re-runs it, and there is no second store to seed: from here on a take
// exists because commitVersion wrote it.
//
// It lives here rather than under pipelines/quests/tools because `pg` is a web dependency
// and this is the app's database; from there the import does not resolve. The same reason
// scripts/apply-overrides.mjs is here.
//
// WHY THE ROWS ARE VERSION 1. These clips were generated. The generator was tts_cli rather
// than the web app, so what it used -- the settings, the seed, the model -- was never
// written down, but that is a gap in the record and not a different kind of take. The app
// used to call them version 0, "the take that predates the app", and that number leaked
// into the schema, the archive naming and the UI, where it read as a line having audio from
// before it had a first take. A line has either been generated or it has not. This is its
// first generation.
//
// `origin = 'imported'`, which is what the zones takes that came in from the old droplet
// already use and means the same thing: this app did not cut it. Nothing else is claimed --
// settings, characters, credits and the spoken hash are all null, which means UNKNOWN and
// not "unchanged". A hash invented here would make every seeded line look current, which is
// the opposite of true: nobody knows what text these were cut from.
//
// THE BYTES STAY WHERE THEY ARE. A seeded take is the live one, so its clip is the store
// file, which is exactly where it already is. Nothing is copied into audio-history; the
// copy is made by commitVersion, the moment a re-roll is about to overwrite it.
//
// It refuses to run against an empty store: a machine with a partial copy would insert rows
// for the clips it happens to have and leave the rest looking ungenerated.

import { readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import pg from "pg";

import { loadEnv } from "../../../pipelines/lib/env.mjs";

await loadEnv("quests");

/** The pipeline's directory, which is where the store and the corpus live by default. */
const ROOT = new URL("../../../pipelines/quests/", import.meta.url).pathname;
const SUBFOLDERS = ["quests", "gossip"];
const LANG = "enUS";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function storeDir() {
  return process.env.SPOKEN_QUESTS_AUDIO ?? join(ROOT, "audio");
}

function corpusPath() {
  return process.env.SPOKEN_QUESTS_CORPUS ?? join(ROOT, "corpus", "corpus.json.gz");
}

/** Store-relative paths of every clip actually on disk, the way lib/audio.ts reads them. */
async function filesOnDisk() {
  const found = new Set();
  for (const sub of SUBFOLDERS) {
    const dir = join(storeDir(), sub);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      if (name.endsWith(".mp3")) found.add(`${sub}/${name}`);
    }
  }
  return found;
}

/**
 * file -> one line that would be spoken into it.
 *
 * One line, not the group: everything sharing a file shares its text and its voice, which
 * is the whole reason they share it. The same rule as fileIndex() in lib/audio.ts, and the
 * filename comes from the corpus rather than being derived here -- tts_cli/naming.py owns
 * that format and a name that differs by one character addresses a file the addon can
 * never find.
 */
function fileIndex(corpus) {
  const index = new Map();
  for (const line of corpus.lines) {
    const sub = line.source === "gossip" ? "gossip" : "quests";
    const file = `${sub}/${line.fileName}.mp3`;
    if (!index.has(file)) index.set(file, line);
  }
  return index;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the takes live in Postgres");

const pool = new pg.Pool({ connectionString: url });

try {
  const disk = await filesOnDisk();
  const corpus = JSON.parse(gunzipSync(await readFile(corpusPath())).toString("utf8"));
  const index = fileIndex(corpus);

  // The id sequence, checked before anything is written. A --data-only dump does not carry
  // it, so a database seeded that way -- which is what `make books-db-pull` and the zones
  // db-pull produce -- hands out ids that already exist, and the insert loop dies partway
  // through against take_pkey. Reported rather than fixed silently: resetting somebody
  // else's sequence is a side effect this tool has no business having.
  const { rows: seq } = await pool.query(
    `select last_value, (select coalesce(max("id"), 0) from "take") as "highest"
       from take_id_seq`,
  );
  if (Number(seq[0].last_value) < Number(seq[0].highest)) {
    throw new Error(
      `the take id sequence is behind the table (${seq[0].last_value} < ${seq[0].highest}), ` +
        "so an insert would collide. Fix it with:\n" +
        `  psql "$DATABASE_URL" -c "select setval(pg_get_serial_sequence('public.take','id'), ` +
        `(select max(\"id\") from \"take\"))"`,
    );
  }

  const { rows: existing } = await pool.query(
    `select distinct "file" from "take" where "source" = 'quests' and "lang" = $1`,
    [LANG],
  );
  const known = new Set(existing.map((row) => row.file));

  // Files the app has already written a take for are left entirely alone. Their history is
  // real and this has nothing to add to it.
  const missing = [...disk].filter((file) => !known.has(file));
  // Clips the corpus cannot name: transcode leftovers, or files for lines a later extract
  // dropped. Reported and skipped rather than given a row with an empty lineId, which would
  // make the explorer's "has audio" disagree with itself.
  const unknown = missing.filter((file) => !index.has(file));
  const insertable = missing.filter((file) => index.has(file));

  console.log(`${disk.size} clips in ${storeDir()}`);
  console.log(`${known.size} already have a take row`);
  console.log(`${insertable.length} need a version 1`);
  if (unknown.length > 0) {
    console.log(`${unknown.length} are not in the corpus and are skipped, e.g.:`);
    for (const file of unknown.slice(0, 5)) console.log(`  ${file}`);
  }

  if (disk.size === 0) {
    throw new Error(
      `no clips under ${storeDir()} -- run this where the store is, or set SPOKEN_QUESTS_AUDIO`,
    );
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
  } else if (insertable.length > 0) {
    let written = 0;
    for (const file of insertable) {
      const line = index.get(file);
      const bytes = (await stat(join(storeDir(), file))).size;

      await pool.query(
        `insert into "take"
           ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "voice",
            "bytes")
         values ('quests', $1, $2, $3, 1, true, 'imported', $4, $5)
         on conflict ("source", "lang", "file", "version") do nothing`,
        [LANG, file, line.lineId, line.voice, bytes],
      );
      written++;
      if (written % 500 === 0) console.log(`  ${written}/${insertable.length}`);
    }
    console.log(`\ninserted ${written} takes at version 1`);
  }
} finally {
  await pool.end();
}
