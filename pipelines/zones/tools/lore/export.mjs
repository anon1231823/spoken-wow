#!/usr/bin/env node
// Writes addons/SpokenZones/Data/enUS/{Zones,Subzones}.lua from lore_line.
//
//   node tools/lore/export.mjs           # write both files
//   node tools/lore/export.mjs --check   # fail if the files are out of date, write nothing
//
// The counterpart to tools/voice/export-manifest.mjs, and there for the same reason: the
// database is where the corpus is authored, and a file is what the addon ships. Between
// the two sits a commit, deliberately -- a text change reaching players should be as
// visible in `git diff` as any other change to what the addon contains.
//
// --check is the CI-shaped question: does the committed Lua still match the database?
// It is not part of `make check`, which has to keep passing on clones with no Postgres.

import { readFile } from "node:fs/promises";

import { zonesLua, subzonesLua } from "../lib/loredata.mjs";
import { loadClientAreas } from "../lib/era.mjs";
import { emitZones, emitSubzones } from "./lua.mjs";
import { isEnabled, readCurrent, writeCorpus } from "./store.mjs";
import { close } from "../voice/db.mjs";
import { loadEnvFile } from "../lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is no corpus to export.");
    console.error("       the committed Lua files are already the record; nothing to do.");
    process.exit(1);
  }

  const allRows = await readCurrent();
  if (allRows.length === 0) {
    console.error("error: lore_line has no rows. Seed it with:  make zones-lore-import");
    process.exit(1);
  }

  // The database keeps every line ever scraped, including places the wiki's
  // categories offered that no client can report (Cataclysm and later). Those rows stay
  // as history; the addon only ships what a client can ask for -- either client, since
  // it ships for both, which is why this is the union and not the Era seed alone.
  const client = await loadClientAreas();
  const rows = allRows.filter((row) => row.kind !== "subzone" || client.keys.has(row.key));
  const unreachable = allRows.length - rows.length;
  if (unreachable) {
    console.log(
      `leaving ${unreachable} line(s) behind: no client can report them ` +
        `(builds ${client.builds.join(", ")})`,
    );
  }

  // A 'discovered' row is a place the client has and nobody has written about yet. It
  // ships anyway, with empty text and a `pending` marker, because a place the player can
  // stand in and see named on the map is worth listing even before anyone has described
  // it: the addon says "not written yet" where it would otherwise say nothing at all, and
  // the subzone shows up in the zone's list rather than being invisible.
  //
  // The marker is what keeps that honest. validate.mjs fails on an entry with empty text,
  // correctly, because for every other origin an empty line is a broken one -- so pending
  // is the exemption it checks for, not a special case for the word "discovered".
  const unwritten = rows.filter((row) => !row.full.trim() || !row.short.trim()).length;
  if (unwritten) {
    console.log(`${unwritten} line(s) ship as pending: discovered, not written yet`);
  }

  const edited = rows.filter((row) => row.origin === "edited").length;

  if (checkOnly) {
    const zones = rows.filter((r) => r.kind === "zone");
    const subzones = rows.filter((r) => r.kind === "subzone");
    const zoneNames = new Map(zones.map((z) => [z.mapID, z.name]));

    const stale = [];
    for (const [path, wanted] of [
      [zonesLua(), emitZones(zones)],
      [subzonesLua(), emitSubzones(subzones, zoneNames)],
    ]) {
      const onDisk = await readFile(path, "utf8").catch(() => null);
      if (onDisk !== wanted) stale.push(path);
    }

    if (stale.length) {
      console.error("out of date with the database:");
      for (const path of stale) console.error(`  ! ${path}`);
      console.error("\nregenerate with:  make lore-export");
      process.exitCode = 1;
      return;
    }

    console.log(`up to date -- ${rows.length} lines, ${edited} hand-edited`);
    return;
  }

  const written = await writeCorpus(rows);
  console.log(
    `wrote ${written.zones} zones and ${written.subzones} subzones ` +
      `(${edited} hand-edited)`,
  );
  console.log("\nreview with:  git diff addon/SpokenZones/Data/");
  console.log("then rebuild the audio lookup if any text moved:  make lookup");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(close);
