#!/usr/bin/env node
// Records where each already-archived take's bytes are, so nothing has to work it out again.
//
//   cd apps/web && node scripts/backfill-archive-names.mjs --dry-run
//   cd apps/web && node scripts/backfill-archive-names.mjs
//   cd apps/web && node scripts/backfill-archive-names.mjs --source zones
//
// THE DATABASE IS WHAT THE APP READS. A take's bytes are located from its row --
// `archiveFile`, or its section's naming rule -- and nothing in a request path lists a
// directory. This script is the exception, and the reason the rule can hold: it is the one
// place where what is on disk and what the table says are compared, the way
// backfill-takes.mjs is for the store.
//
// It matters for zones and books, whose older archived clips were numbered by POSITION in a
// sequence of overwrites rather than by take version: `v2.mp3` there means "the second clip
// this file displaced", which is not take 2. Quests named its archives after the version
// from the start, so its rows need nothing and are skipped unless asked for.
//
// THE PAIRING, AND WHEN IT REFUSES. Each archived clip is one that a later cut displaced,
// so the names in ascending order line up with the superseded takes in ascending order,
// oldest first -- the live take is not among them, having displaced nothing yet. That holds
// only if nothing has been removed, so the counts must match exactly. Three clips for five
// superseded takes means two are gone and any pairing is an offset guess; those rows are
// left null and reported. A wrong answer here is silent -- it resolves, it looks right, and
// it plays somebody else's line.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import pg from "pg";

import { loadEnv } from "../../../pipelines/lib/env.mjs";

await loadEnv("quests");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const only = process.argv.includes("--source")
  ? process.argv[process.argv.indexOf("--source") + 1]
  : null;
const LANG = "enUS";

/** Where each section keeps its archived takes. Mirrors lib/takes/adapters.ts. */
function historyRoot(source) {
  if (source === "zones") {
    return (
      process.env.SPOKEN_ZONES_AUDIO_HISTORY ??
      new URL("../../../pipelines/zones/audio-history", import.meta.url).pathname
    );
  }
  if (source === "books") {
    const store =
      process.env.SPOKEN_BOOKS_AUDIO ??
      new URL("../../../pipelines/books/audio", import.meta.url).pathname;
    return process.env.SPOKEN_BOOKS_AUDIO_HISTORY ?? `${store}-history`;
  }
  return (
    process.env.SPOKEN_QUESTS_AUDIO_HISTORY ??
    new URL("../../../pipelines/quests/audio-history", import.meta.url).pathname
  );
}

/** Quests mirrors the store one level deeper; the other two use the file as the directory. */
function historyDir(source, file) {
  if (source !== "quests") return join(historyRoot(source), file);
  const slash = file.lastIndexOf("/");
  const sub = slash === -1 ? "" : file.slice(0, slash);
  const stem = file.slice(slash + 1).replace(/\.mp3$/, "");
  return join(historyRoot(source), sub, stem);
}

const numberIn = (name) => {
  const match = /^v?(\d+)\.mp3$/.exec(name);
  return match ? Number(match[1]) : null;
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set -- the takes live in Postgres");

const pool = new pg.Pool({ connectionString: url });
const sources = only ? [only] : ["zones", "books"];

try {
  for (const source of sources) {
    const { rows } = await pool.query(
      `select "file", "version", "isCurrent", "archiveFile"
         from "take" where "source" = $1 and "lang" = $2
        order by "file", "version"`,
      [source, LANG],
    );

    const byFile = new Map();
    for (const row of rows) {
      if (!byFile.has(row.file)) byFile.set(row.file, []);
      byFile.get(row.file).push(row);
    }

    let named = 0;
    let already = 0;
    let refused = 0;
    let noArchive = 0;

    for (const [file, takes] of byFile) {
      const unresolved = takes.filter((t) => !t.archiveFile && !t.isCurrent);
      already += takes.filter((t) => t.archiveFile).length;
      if (unresolved.length === 0) continue;

      const names = (await readdir(historyDir(source, file)).catch(() => []))
        .filter((name) => numberIn(name) !== null)
        .sort((a, b) => numberIn(a) - numberIn(b));

      if (names.length === 0) {
        noArchive += unresolved.length;
        continue;
      }
      if (names.length !== unresolved.length) {
        refused += unresolved.length;
        continue;
      }

      for (const [index, take] of unresolved.entries()) {
        if (!dryRun) {
          await pool.query(
            `update "take" set "archiveFile" = $5
              where "source" = $1 and "file" = $2 and "lang" = $3 and "version" = $4`,
            [source, file, LANG, take.version, names[index]],
          );
        }
        named++;
      }
    }

    console.log(
      `${source}: ${named} takes named${dryRun ? " (dry run)" : ""}, ` +
        `${already} already recorded, ${refused} refused (the counts disagree), ` +
        `${noArchive} have no archived clip at all`,
    );
  }
} finally {
  await pool.end();
}
