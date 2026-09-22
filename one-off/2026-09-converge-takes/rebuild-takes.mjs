#!/usr/bin/env node
// ONE-OFF, RUN ONCE BY run.sh. Kept for the record; see ../README.md. Not maintained.
//
// Rebuilds the quests take table from the two things that actually record what happened:
// the rows already in Postgres, and the files in audio-history/.
//
//   DATABASE_URL=… node rebuild-takes.mjs --listing shared.txt --dry-run
//   DATABASE_URL=… node rebuild-takes.mjs --listing shared.txt
//
// The listing is production's shared/ directory, taken by run.sh on the droplet: every mp3
// under audio/ (the quests store), sounds/, books/ and audio-history/, one `<bytes> <path>`
// per line. It is the only way this reads the disk, so it runs from a laptop against a
// database it is pointed at, and a rehearsal against a copy reads exactly what production
// has.
//
// ALL THREE SECTIONS, TWO JOBS. Quests needs its history rebuilt and renumbered, below.
// Zones and books need only to be told where their bytes are: their versions already start
// at 1, and every take already has a row. Their archives were written by the code before
// this branch, which MOVED the live clip to v{n}.mp3 with n counted from the directory --
// a position in a sequence of overwrites, not a take version. So a zones or books row is
// matched to its clip by size, which rows record and the listing carries: identical sizes
// in one line's history are identical bytes (a restore of an older take), so every row of
// a given size may point at the one clip. A row that matches nothing had its clip consumed
// by the old rename-to-restore, and is left without one.
//
// SAFE TO RE-RUN. Zones and books only ever fill an empty archiveFile. Quests is skipped
// once any of its takes carries one, because renumbering is not repeatable: a second pass
// would union the new numbers with the archive's old ones and invent takes.
//
// WHY THE TABLE IS NOT ALREADY THE ANSWER. The app used to prune: keep the newest few
// takes, delete the rest, rows and files together (KEEP_VERSIONS, deleteVersions,
// pruneVersionFiles). It deleted oldest-first, so what is missing from any file is a
// prefix -- 1,390 production files have no version 0 or 1, 63 have no 0, 1 or 2. The rows
// are gone. Where pruning did not reach the file, the clip is still in audio-history and is
// the only surviving record that the take happened.
//
// WHAT THE ARCHIVE IS, EXACTLY. Every clip under audio-history was written by this app's
// archiveStoreFile, named `{version}.mp3` after the take it holds. tts_cli never wrote
// there -- it overwrites the store in place -- so the CLI's own re-rolls left no trace
// anywhere and are not recoverable by this or anything else. A line the CLI narrated and
// never re-rolled through the app has exactly one take, and that is the honest answer.
//
// THE NUMBERING. A file's takes are the union of the numbers the archive carries and the
// numbers its rows carry, sorted ascending, renumbered 1..n. The old numbering started at
// 0 for audio that predated the app; there is no version 0 now, and a line is either
// generated or it is not, so the pre-app take becomes version 1 like any other first take.
// Every row gets its `archiveFile` pinned to the real filename, so renumbering moves no
// bytes and nothing has to infer a name afterwards.
//
//     disk:     0.mp3  1.mp3  2.mp3  3.mp3  4.mp3  5.mp3
//     version:    1      2      3      4      5      6
//
// A row whose number the archive does not carry is kept and left with a null archiveFile:
// pruning deleted its clip, the take still happened, and the player says so when somebody
// asks to hear it. A file with neither rows nor archive gets one take at version 1, which
// is what the store file is.
//
// The live take is whichever number was live before, carried across to its new number. If
// nothing was live -- a file the app never touched -- it is the newest take.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { gunzipSync } from "node:zlib";

// pg is the web app's dependency; this folder has no node_modules of its own, on purpose.
const pg = createRequire(new URL("../../apps/web/package.json", import.meta.url))("pg");

const LANG = "enUS";
const CORPUS = new URL("../../pipelines/quests/corpus/corpus.json.gz", import.meta.url).pathname;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const listingPath = argv.includes("--listing") ? argv[argv.indexOf("--listing") + 1] : null;
if (!listingPath) throw new Error("--listing <file> is required: run.sh takes it on the droplet");

/**
 * Production's shared/ listing, split into what each step reads: the quests store as
 * file -> bytes, and the archive as `<bytes> <section>/<path>` lines, the shape the
 * parsers below were written for.
 *
 * Refuses a listing missing any of the four, because each is one step's whole input: a
 * listing taken in the wrong directory would otherwise renumber quests from its rows alone
 * and pin no zones or books take, and say it had succeeded.
 */
function splitListing(text) {
  const store = new Map();
  const archive = [];
  const counts = { store: 0, quests: 0, zones: 0, books: 0 };
  for (const line of text.split("\n")) {
    const match = /^(\d+) (?:\.\/)?(.+)$/.exec(line.trim());
    if (!match) continue;
    const [, bytes, path] = match;
    if (path.startsWith("audio/")) {
      store.set(path.slice("audio/".length), Number(bytes));
      counts.store++;
    } else if (path.startsWith("audio-history/")) {
      const relative = path.slice("audio-history/".length);
      archive.push(`${bytes} ${relative}`);
      const section = relative.split("/")[0];
      if (section in counts) counts[section]++;
    }
  }
  for (const [part, count] of Object.entries(counts)) {
    if (count === 0) throw new Error(`the listing has no ${part} clips -- was it taken in shared/?`);
  }
  return { store, archive: archive.join("\n") };
}

/**
 * The history directory's path for a store file, and back again.
 *
 * audio-history mirrors the store one level deeper: audio/gossip/31ab….mp3 is archived
 * under audio-history/gossip/31ab…/. Mirrors lib/takes/adapters.ts, which owns the rule.
 */
function fileForHistoryPath(relative) {
  // The droplet keeps one audio-history for the whole site, a directory per section:
  // audio-history/quests/gossip/31ab…/0.mp3. A listing taken at that root therefore carries
  // a leading 'quests/' that a listing taken at the quests history root does not. Strip it
  // when it is there, so either listing reads the same, and drop the other two sections.
  if (/^(zones|books)\//.test(relative)) return null;
  relative = relative.replace(/^quests\//, "");

  // 'quests/4298-accept/0.mp3' -> ['quests/4298-accept', '0.mp3']
  const cut = relative.lastIndexOf("/");
  if (cut === -1) return null;
  const dir = relative.slice(0, cut);
  const name = relative.slice(cut + 1);
  const match = /^(\d+)\.mp3$/.exec(name);
  if (!match) return null;
  return { file: `${dir}.mp3`, version: Number(match[1]), name };
}

/**
 * file -> [{ version, name, bytes }], from a listing rather than a walk.
 *
 * The listing is `find -L . -name '*.mp3' -printf '%s %P\n'` run inside audio-history, so
 * this can be built on a machine that does not hold the archive -- which is the whole point:
 * the archive is on the droplet and the reconstruction is not.
 */
function parseArchive(text) {
  const byFile = new Map();
  let skipped = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const space = line.indexOf(" ");
    if (space === -1) continue;
    const bytes = Number(line.slice(0, space));
    const relative = line.slice(space + 1).replace(/^\.\//, "");
    const parsed = fileForHistoryPath(relative);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (!byFile.has(parsed.file)) byFile.set(parsed.file, []);
    byFile.get(parsed.file).push({ version: parsed.version, name: parsed.name, bytes });
  }
  for (const takes of byFile.values()) takes.sort((a, b) => a.version - b.version);
  return { byFile, skipped };
}

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

async function rebuildQuests(store, listing) {
  // Rebuilt before if any take points at a bare `{n}.mp3`. Only this script writes those:
  // everything commitTake archives is `v{n}-{hash}.mp3`. Asking whether ANY take has an
  // archiveFile would be wrong -- the first quests line regenerated after deploy has one,
  // and would make this skip every other line in the corpus.
  const { rows: done } = await pool.query(
    `select count(*)::int as "n" from "take"
      where "source" = 'quests' and "archiveFile" ~ '^[0-9]+\\.mp3$'`,
  );
  if (done[0].n > 0) {
    console.log(`quests: ${done[0].n} takes already point at the old archive -- rebuilt before, skipped`);
    return;
  }

  const archive = parseArchive(listing);

  const corpus = JSON.parse(gunzipSync(await readFile(CORPUS)).toString("utf8"));
  const index = fileIndex(corpus);

  const { rows } = await pool.query(
    `select * from "take" where "source" = 'quests' and "lang" = $1 order by "file", "version"`,
    [LANG],
  );
  const byFile = new Map();
  for (const row of rows) {
    if (!byFile.has(row.file)) byFile.set(row.file, []);
    byFile.get(row.file).push(row);
  }

  // Every file worth having a take: what is in the store, plus anything the archive knows
  // about that the store has lost, plus anything the table already claims.
  const files = new Set([...store.keys(), ...archive.byFile.keys(), ...byFile.keys()]);

  const plan = [];
  const unknown = [];
  for (const file of [...files].sort()) {
    const existing = byFile.get(file) ?? [];
    const archived = archive.byFile.get(file) ?? [];
    const line = index.get(file);
    if (!line && existing.length === 0) {
      unknown.push(file);
      continue;
    }

    // The union, which is what "every take that happened" means here: a number the archive
    // carries is a take whose clip survived, a number only the table carries is a take
    // whose clip pruning deleted. Both happened.
    const olds = [...new Set([...archived.map((a) => a.version), ...existing.map((r) => r.version)])];
    olds.sort((a, b) => a - b);

    const liveOld = existing.find((row) => row.isCurrent)?.version ?? olds[olds.length - 1];
    const archiveByOld = new Map(archived.map((a) => [a.version, a]));
    const rowByOld = new Map(existing.map((r) => [r.version, r]));

    const takes = olds.map((old, i) => ({
      version: i + 1,
      old,
      row: rowByOld.get(old) ?? null,
      // The listing's name when it has one; otherwise whatever the row already records, which
      // is how a take cut after deploy -- archived as v{n}-{hash}.mp3, a name the old-style
      // listing parser does not read -- keeps its own.
      archiveFile: archiveByOld.get(old)?.name ?? rowByOld.get(old)?.archiveFile ?? null,
      bytes: archiveByOld.get(old)?.bytes ?? rowByOld.get(old)?.bytes ?? store.get(file) ?? 0,
      isCurrent: old === liveOld,
    }));

    // Neither rows nor archive: the store file is the one take anybody knows about.
    if (takes.length === 0) {
      takes.push({
        version: 1,
        old: null,
        row: null,
        archiveFile: null,
        bytes: store.get(file) ?? 0,
        isCurrent: true,
      });
    }

    const unchanged =
      existing.length === takes.length &&
      takes.every((t) => t.row && t.row.version === t.version && t.row.archiveFile === t.archiveFile);
    if (!unchanged) plan.push({ file, line, takes, existing });
  }

  const newRows = plan.reduce((sum, p) => sum + p.takes.filter((t) => !t.row).length, 0);
  const renumbered = plan.reduce(
    (sum, p) => sum + p.takes.filter((t) => t.row && t.row.version !== t.version).length,
    0,
  );

  console.log(`${store.size} clips in the quests store`);
  console.log(`${archive.byFile.size} files have archived takes (${archive.skipped} names skipped)`);
  console.log(`${rows.length} take rows now`);
  console.log(`${plan.length} files change: ${newRows} takes recovered, ${renumbered} renumbered`);
  if (unknown.length > 0) {
    console.log(`${unknown.length} clips are not in the corpus and are skipped, e.g.:`);
    for (const file of unknown.slice(0, 5)) console.log(`  ${file}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written. A sample of what would change:\n");
    for (const entry of plan.filter((p) => p.takes.length > 1).slice(0, 5)) {
      const before = entry.existing.map((r) => r.version).join(",") || "none";
      const after = entry.takes
        .map((t) => `${t.version}${t.archiveFile ? `=${t.archiveFile}` : "*"}`)
        .join(" ");
      console.log(`  ${entry.file}\n    rows now: ${before}\n    becomes:  ${after}`);
    }
    console.log("\n  (* = no archived clip; the take happened, its bytes were pruned away)");
  } else {
    let done = 0;
    for (const entry of plan) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        // Replaced rather than updated in place: renumbering upward collides with
        // take_source_lang_file_version_key row by row, and nothing references a take by
        // id -- migration 0020 says so where it declines to preserve them.
        await client.query(
          `delete from "take" where "source" = 'quests' and "lang" = $1 and "file" = $2`,
          [LANG, entry.file],
        );
        for (const take of entry.takes) {
          // A take with a row keeps EVERY column of it -- whatever the table has grown since
          // this was written, a lead-in, a duration -- and changes only what the rebuild is
          // for: its number, whether it is live, and where its bytes are. A fixed column list
          // here silently dropped whatever it did not name.
          const values = take.row
            ? { ...take.row }
            : {
                source: "quests",
                lang: LANG,
                file: entry.file,
                lineId: entry.line.lineId,
                voice: entry.line.voice,
                createdAt: new Date(),
              };
          delete values.id;
          Object.assign(values, {
            version: take.version,
            isCurrent: take.isCurrent,
            // A row this app wrote stays 'generated'; a take only the archive remembers, or a
            // store file with no history, is 'imported' -- this app did not cut it, or cut
            // it under a record that pruning destroyed.
            origin: take.row?.origin === "generated" ? "generated" : "imported",
            bytes: take.bytes,
            archiveFile: take.archiveFile,
          });
          const columns = Object.keys(values);
          await client.query(
            `insert into "take" (${columns.map((c) => `"${c}"`).join(", ")})
             values (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
            columns.map((c) =>
              c === "settings" && values[c] !== null && typeof values[c] === "object"
                ? JSON.stringify(values[c])
                : values[c],
            ),
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      done++;
      if (done % 500 === 0) console.log(`  ${done}/${plan.length}`);
    }
    console.log(`\nquests: rebuilt ${done} files`);
  }
}

/**
 * Zones or books: point every row that has no archiveFile at its clip, matched by size.
 *
 * The listing's paths are `<section>/<file>/v<n>.mp3`, where <file> is the store path
 * without its extension -- one directory for zones ('1417/northfold-manor'), one segment
 * for books ('306').
 */
async function pinSection(source, listing) {
  const clips = new Map(); // file -> [{ name, bytes }]
  for (const line of listing.split("\n")) {
    const match = /^(\d+) (?:\.\/)?([a-z]+)\/(.+)\/(v\d+\.mp3)$/.exec(line.trim());
    if (!match || match[2] !== source) continue;
    const [, bytes, , file, name] = match;
    if (!clips.has(file)) clips.set(file, []);
    clips.get(file).push({ name, bytes: Number(bytes) });
  }
  // Lowest name first, so of two identical clips the older is the one pointed at.
  for (const list of clips.values()) {
    list.sort((a, b) => Number(a.name.slice(1, -4)) - Number(b.name.slice(1, -4)));
  }

  const { rows } = await pool.query(
    `select "file", "version", "bytes"::float8 as "bytes" from "take"
      where "source" = $1 and "lang" = $2 and "archiveFile" is null`,
    [source, LANG],
  );

  const pins = [];
  let unmatched = 0;
  for (const row of rows) {
    const clip = (clips.get(row.file) ?? []).find((c) => c.bytes === row.bytes);
    if (clip) pins.push({ file: row.file, version: row.version, name: clip.name });
    else unmatched++;
  }

  console.log(
    `${source}: ${clips.size} files have archived clips; ${rows.length} takes have no ` +
      `archiveFile, ${pins.length} matched by size, ${unmatched} have no clip`,
  );
  if (dryRun) return;

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const pin of pins) {
      await client.query(
        `update "take" set "archiveFile" = $5
          where "source" = $1 and "lang" = $2 and "file" = $3 and "version" = $4
            and "archiveFile" is null`,
        [source, LANG, pin.file, pin.version, pin.name],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  console.log(`${source}: pinned ${pins.length}`);
}

try {
  const { store, archive } = splitListing(await readFile(listingPath, "utf8"));
  await rebuildQuests(store, archive);
  await pinSection("zones", archive);
  await pinSection("books", archive);
  if (dryRun) console.log("\n--dry-run: nothing written");
} finally {
  await pool.end();
}
