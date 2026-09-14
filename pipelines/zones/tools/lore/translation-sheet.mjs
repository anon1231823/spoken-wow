#!/usr/bin/env node
// Writes the sheet a translator fills in: every line, English beside the blanks.
//
//   SPOKEN_ZONES_LANG=deDE node tools/lore/translation-sheet.mjs dist/lore-deDE.csv
//
// One CSV per language, opened in any spreadsheet. The English columns are for
// reading; `name`, `full` and `short` are the ones to fill, and they come back
// through tools/lore/upload-translations.mjs. Anything already translated is
// filled in, so a sheet written today is also the review copy of what exists,
// and re-uploading it unchanged records nothing.
//
// Only lines the Era client can report are listed, the same filter export.mjs
// applies: nobody should spend an afternoon translating a place no player can
// stand in.
//
// Columns:
//   lineId        the line's key -- do not edit; the upload matches on it
//   zone, place   where it is, in English, for orientation
//   name          the place as the client calls it in this language -- for
//                 reference only; place names come from the client's own area
//                 table, and the upload ignores this column
//   english       the English text being translated from
//   full          the translated text (blank: line not translated, skipped on upload)
//   short         optional; the hover-preview summary. Blank: derived from `full`.

import { writeFile } from "node:fs/promises";

import { areaName, loadAreaNames } from "../lib/area-names.mjs";
import { toCsv } from "../lib/csv.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import { loadEraAreas } from "../lib/era.mjs";
import { BASE_LOCALE, isLocale } from "../lib/locales.mjs";
import { close } from "../voice/db.mjs";
import { isEnabled, readCurrent } from "./store.mjs";

await loadEnvFile();

export const SHEET_COLUMNS = ["lineId", "zone", "place", "name", "english", "full", "short"];

const lang = process.env.SPOKEN_ZONES_LANG || BASE_LOCALE;
const out = process.argv[2];

if (!isLocale(lang) || lang === BASE_LOCALE) {
  console.error(`error: SPOKEN_ZONES_LANG must name a language other than English (got ${lang}).`);
  console.error("       usage:  make lore-sheet LOCALE=deDE OUT=dist/lore-deDE.csv");
  process.exit(1);
}
if (!out) {
  console.error("error: give the file to write:  node tools/lore/translation-sheet.mjs dist/lore-deDE.csv");
  process.exit(1);
}

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is no corpus to read.");
    process.exit(1);
  }

  const [english, translated, era, names] = await Promise.all([
    readCurrent(BASE_LOCALE),
    readCurrent(lang),
    loadEraAreas(),
    loadAreaNames(),
  ]);
  if (english.length === 0) {
    console.error("error: lore_line has no English rows. Seed it with:  make lore-import");
    process.exit(1);
  }

  const zoneNames = new Map(english.filter((r) => r.kind === "zone").map((r) => [r.mapID, r.name]));
  const existing = new Map(translated.map((r) => [r.lineId, r]));

  const rows = english
    .filter((row) => row.kind !== "subzone" || era.keys.has(row.key))
    // Zones first, then their subzones by name: the order a translator would read in.
    .sort(
      (a, b) =>
        a.mapID - b.mapID ||
        (a.kind === "zone" ? -1 : b.kind === "zone" ? 1 : a.name.localeCompare(b.name)),
    )
    .map((row) => {
      const done = existing.get(row.lineId);
      return {
        lineId: row.lineId,
        zone: zoneNames.get(row.mapID) ?? String(row.mapID),
        place: row.kind === "zone" ? "(zone)" : row.name,
        name: areaName(names, lang, row),
        english: row.full,
        full: done?.full ?? "",
        short: done?.shortIsManual ? done.short : "",
      };
    });

  await writeFile(out, toCsv(SHEET_COLUMNS, rows));
  const filled = rows.filter((r) => r.full).length;
  console.log(`wrote ${out}: ${rows.length} lines, ${filled} already translated into ${lang}`);
}

try {
  await main();
} finally {
  await close();
}
