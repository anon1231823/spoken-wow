#!/usr/bin/env node
// Gives every clip in the quests store a take row, so the database can answer which lines
// have audio.
//
//   cd apps/web && node scripts/backfill-takes.mjs --dry-run     # report, write nothing
//   cd apps/web && node scripts/backfill-takes.mjs               # insert the missing rows
//   cd apps/web && node scripts/backfill-takes.mjs --reconcile   # retire rows gone stale
//
// It lives here rather than under pipelines/quests/tools because `pg` is a web dependency
// and this is the app's database; from there the import does not resolve. The same reason
// scripts/apply-overrides.mjs is here.
//
// WHY THIS EXISTS. The site used to answer "does this line have audio?" with a readdir of
// the store, because that is where the answer was: most of this corpus was narrated by the
// Python CLI years before the app recorded takes at all. Zones and books have always
// answered it from a take row instead, and one question with two implementations is one
// that drifts -- the disk scan cannot say which take is live, what it cost, or whether it
// is the one somebody restored. This inserts the rows that make the database's answer true.
//
// `origin = 'inherited'`, which migration 0020 reserves for exactly this: audio that
// predates the app that would have recorded how it was made. Nothing else is claimed --
// settings, characters, credits and the spoken hash are all null, which means UNKNOWN and
// not "unchanged". A hash invented here would make every inherited line look current, which
// is the opposite of true: nobody knows what text these were cut from.
//
// Version 0 where it is free, which is the number the archive already reserves for the
// inherited take (lib/generation/archive.ts) -- so a later re-roll archives this clip as
// v0 and the numbering stays what it always was.
//
// RUNS WHERE THE STORE IS. A machine with a partial copy of the store would insert rows for
// the clips it happens to have; the rest would read as missing until somebody noticed. It
// refuses to run against a store that is empty, and prints what it is about to do first.
//
// --reconcile is the other half, and the reason this is a tool rather than a migration:
// `make quests-push` and `make quests-pull` rsync with --delete, so a file can leave the
// store after its row exists. The row would then claim audio that is not there -- a badge
// lying in the direction that matters, since "has audio" is what the explorer trusts.
// Reconciling clears the live flag for those, leaving the row as the record that the take
// existed. Run it after every push or pull.

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
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
const reconcile = args.has("--reconcile");

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
    `select "file", max("version")::int as "highest",
            bool_or("isCurrent") as "live"
       from "take" where "source" = 'quests' and "lang" = $1 group by "file"`,
    [LANG],
  );
  const known = new Map(existing.map((row) => [row.file, row]));

  if (reconcile) {
    // Rows claiming a file that is no longer there. The row stays -- it is still a true
    // record that the take existed -- but it stops being the live one, which is what the
    // explorer reads.
    const orphaned = existing.filter((row) => row.live && !disk.has(row.file));
    console.log(`${orphaned.length} live takes have no file in the store`);
    if (!dryRun && orphaned.length > 0) {
      await pool.query(
        `update "take" set "isCurrent" = false
          where "source" = 'quests' and "lang" = $1 and "isCurrent" and "file" = any($2::text[])`,
        [LANG, orphaned.map((row) => row.file)],
      );
      console.log(`retired ${orphaned.length}`);
    }
  }

  const missing = [...disk].filter((file) => !known.has(file));
  // Clips the corpus cannot name: transcode leftovers, or files for lines a later extract
  // dropped. Reported and skipped rather than given a row with an empty lineId, which would
  // make the explorer's "has audio" disagree with itself.
  const unknown = missing.filter((file) => !index.has(file));
  const insertable = missing.filter((file) => index.has(file));

  console.log(`${disk.size} clips in ${storeDir()}`);
  console.log(`${known.size} already have a take row`);
  console.log(`${insertable.length} need an inherited take`);
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
      // Version 0 when this file has no rows at all, which is what the archive reserves for
      // the inherited take; past the highest otherwise, so a number is never reissued.
      const version = known.has(file) ? known.get(file).highest + 1 : 0;

      await pool.query(
        `insert into "take"
           ("source", "lang", "file", "lineId", "version", "isCurrent", "origin", "voice",
            "bytes")
         values ('quests', $1, $2, $3, $4, true, 'inherited', $5, $6)
         on conflict ("source", "lang", "file", "version") do nothing`,
        [LANG, file, line.lineId, version, line.voice, bytes],
      );
      written++;
      if (written % 500 === 0) console.log(`  ${written}/${insertable.length}`);
    }
    console.log(`\ninserted ${written} inherited takes`);
  }
} finally {
  await pool.end();
}
