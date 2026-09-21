#!/usr/bin/env node
// Assemble a section's Sounds folder from the database: every live take, copied out of the
// archive under the path the addon plays it from.
//
//   node scripts/audio/sounds.mjs <quests|zones|books>      (LOCAL_DB names the database)
//
// THE ARCHIVE IS THE ONLY AUDIO THERE IS. Every take is one file there, written once by the
// site and never changed; which take is live is a flag on its row. So the folder a pack is
// built from is not kept anywhere -- it is made here, from the live rows and the archive,
// right before packaging, and thrown away and made again the next time.
//
// Needs the section's archive on this machine (make <section>-pull-history) and a database
// that matches production (make <section>-sync). A live take whose file is not here is a
// pack that would ship silence for that line, so it stops rather than build one.
//
// The folder is only ever emptied if this script made it -- it leaves a marker -- so a
// folder holding audio from before the archive was the record is refused, not deleted.
//
// Copies are clones where the filesystem has them (APFS, btrfs, XFS): no extra space and
// next to no time, and unlike a hard link, a tool that later writes into Sounds/ cannot
// reach the archive. The database is asked through psql, as scripts/db/ does, so this needs
// no node_modules.
import { execFileSync } from "node:child_process";
import { constants, existsSync, readdirSync } from "node:fs";
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SECTIONS = {
  quests: {
    archive: process.env.SPOKEN_QUESTS_AUDIO_HISTORY ?? join(ROOT, "pipelines/quests/audio-history"),
    out: join(ROOT, "pipelines/quests/audio"),
  },
  zones: {
    archive: process.env.SPOKEN_ZONES_AUDIO_HISTORY ?? join(ROOT, "pipelines/zones/audio-history"),
    out: join(ROOT, "addons/SpokenZonesAudio/Sounds"),
  },
  books: {
    archive: process.env.SPOKEN_BOOKS_AUDIO_HISTORY ?? join(ROOT, "pipelines/books/audio-history"),
    out: join(ROOT, "addons/SpokenBooksAudio/Sounds"),
  },
};

const section = process.argv[2];
const paths = SECTIONS[section];
if (!paths) {
  console.error("usage: sounds.mjs <quests|zones|books>");
  process.exit(1);
}
const database = process.env.LOCAL_DB;
if (!database) {
  console.error("LOCAL_DB is not set");
  process.exit(1);
}

const marker = join(paths.out, ".from-takes");
if (existsSync(paths.out) && !existsSync(marker) && readdirSync(paths.out).length > 0) {
  console.error(`refusing: ${paths.out} holds audio this script did not put there.`);
  console.error("It is from before the archive was the record. Move it aside, then run this again:");
  console.error(`  mv '${paths.out}' '${paths.out}.before-archive'`);
  process.exit(1);
}

// file <tab> archiveFile, for every live take. A quests file carries its extension and the
// other two do not; the archive directory is the file without it either way.
const listing = execFileSync(
  "psql",
  [database, "-tA", "-F", "\t", "-v", `source=${section}`, "-f", "-"],
  {
    input: `select "file", coalesce("archiveFile", '') from "take"
             where "source" = :'source' and "lang" = 'enUS' and "isCurrent"
             order by "file"`,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  },
);

await rm(paths.out, { recursive: true, force: true });
await mkdir(paths.out, { recursive: true });
await writeFile(marker, "");

let copied = 0;
const gone = [];
const missing = [];
const made = new Set();
for (const row of listing.split("\n")) {
  if (!row) continue;
  const [file, name] = row.split("\t");
  const stem = file.replace(/\.mp3$/, "");
  if (!name) {
    gone.push(file);
    continue;
  }
  const source = join(paths.archive, stem, name);
  const target = join(paths.out, `${stem}.mp3`);
  const dir = dirname(target);
  if (!made.has(dir)) {
    await mkdir(dir, { recursive: true });
    made.add(dir);
  }
  try {
    await copyFile(source, target, constants.COPYFILE_FICLONE);
    copied++;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missing.push(source);
  }
}

console.log(`${section}: ${copied} clips in ${paths.out.slice(ROOT.length + 1)}`);
if (gone.length) {
  // Known, and not this machine's fault: the take's clip was not kept before the archive
  // was the record. The line ships without audio, the same as one never generated.
  console.log(`  ${gone.length} live takes had their clip discarded before the archive kept every take; shipped silent`);
}
if (missing.length) {
  console.error(`  ${missing.length} live takes are not in this machine's archive, e.g.:`);
  for (const path of missing.slice(0, 5)) console.error(`    ${path}`);
  console.error(`  Fetch them with:  make ${section}-pull-history`);
  process.exit(1);
}
