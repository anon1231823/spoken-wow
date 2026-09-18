#!/usr/bin/env node
// Writes addon/SpokenZones/Data/<lang>/{Zones,Subzones}.lua from lore_line.
//
//   node tools/lore/export.mjs           # write both files
//   node tools/lore/export.mjs --check   # fail if the files are out of date, write nothing
//   SPOKEN_ZONES_LANG=deDE node tools/lore/export.mjs   # a language other than English
//
// The counterpart to tools/voice/export-manifest.mjs, and there for the same reason: the
// database is where the corpus is authored, and a file is what the addon ships. Between
// the two sits a commit, deliberately -- a text change reaching players should be as
// visible in `git diff` as any other change to what the addon contains.
//
// --check is the CI-shaped question: does the committed Lua still match the database?
// It is not part of `make check`, which has to keep passing on clones with no Postgres.

import { readFile } from "node:fs/promises";

import { BASE_LOCALE, isLocale } from "../lib/locales.mjs";
import { zonesLua, subzonesLua } from "../lib/loredata.mjs";
import { loadEraAreas } from "../lib/era.mjs";
import { emitZones, emitSubzones } from "./lua.mjs";
import { isEnabled, readCurrent, writeCorpus } from "./store.mjs";
import { close } from "../voice/db.mjs";
import { loadEnvFile } from "../lib/env.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check");

const lang = process.env.SPOKEN_ZONES_LANG || BASE_LOCALE;
if (!isLocale(lang)) {
  console.error(`error: SPOKEN_ZONES_LANG=${lang} is not a WoW locale code.`);
  process.exit(1);
}

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is no corpus to export.");
    console.error("       the committed Lua files are already the record; nothing to do.");
    process.exit(1);
  }

  const allRows = await readCurrent(lang);
  if (allRows.length === 0) {
    console.error(`error: lore_line has no ${lang} rows. Seed English with:  make lore-import`);
    process.exit(1);
  }

  // The database keeps every line ever scraped, including places the wiki's
  // categories offered that the Era client cannot report (Cataclysm and later).
  // Those rows stay as history; the addon only ships what the client can ask for.
  const era = await loadEraAreas();
  const rows = allRows.filter((row) => row.kind !== "subzone" || era.keys.has(row.key));
  const notInEra = allRows.length - rows.length;
  if (notInEra) {
    console.log(`leaving ${notInEra} line(s) behind: not in the Era client (build ${era.build})`);
  }

  const edited = rows.filter((row) => row.origin === "edited").length;

  if (checkOnly) {
    const zones = rows.filter((r) => r.kind === "zone");
    const subzones = rows.filter((r) => r.kind === "subzone");
    const zoneNames = new Map(zones.map((z) => [z.mapID, z.name]));

    const stale = [];
    for (const [path, wanted] of [
      [zonesLua(lang), emitZones(zones, lang)],
      [subzonesLua(lang), emitSubzones(subzones, zoneNames, lang)],
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

    console.log(`up to date -- ${lang}, ${rows.length} lines, ${edited} hand-edited`);
    return;
  }

  const written = await writeCorpus(rows, lang);
  console.log(
    `wrote ${written.zones} zones and ${written.subzones} subzones in ${lang} ` +
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
