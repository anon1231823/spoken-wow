#!/usr/bin/env node
// Records a translator's sheet as that language's lore.
//
//   ZONELORE_LANG=deDE node tools/lore/upload-translations.mjs dist/lore-deDE.csv --dry-run
//   ZONELORE_LANG=deDE node tools/lore/upload-translations.mjs dist/lore-deDE.csv
//
// The sheet is the one translation-sheet.mjs wrote, filled in. Rows with an
// empty `full` are not translated and are skipped; the rest are recorded as
// 'translated' versions of the line in this language, through the same rules the
// scraper and the rewriter follow (recordTranslations in store.mjs): unchanged text
// records nothing, and a line somebody has since edited by hand in the explorer
// keeps that edit -- the upload lands underneath it, kept but not live.
//
// Then export the language and rebuild the readiness table, so the addon and the
// switcher see it:  make lore-export LOCALE=deDE && make languages
//
// Free. No model, no network; the sheet is what somebody already wrote.

import { readFile } from "node:fs/promises";

import { parseCsv } from "../lib/csv.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import { BASE_LOCALE, isLocale } from "../lib/locales.mjs";
import { close } from "../voice/db.mjs";
import { isEnabled, readCurrent, recordTranslations } from "./store.mjs";

await loadEnvFile();

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const file = argv.find((a) => !a.startsWith("--"));
const lang = process.env.ZONELORE_LANG || BASE_LOCALE;

if (!isLocale(lang) || lang === BASE_LOCALE) {
  console.error(`error: ZONELORE_LANG must name a language other than English (got ${lang}).`);
  console.error("       usage:  make lore-upload LOCALE=deDE FILE=dist/lore-deDE.csv");
  process.exit(1);
}
if (!file) {
  console.error("error: give the sheet to upload:  node tools/lore/upload-translations.mjs dist/lore-deDE.csv");
  process.exit(1);
}

async function main() {
  if (!isEnabled()) {
    console.error("error: DATABASE_URL is not set, so there is nothing to upload into.");
    process.exit(1);
  }

  const { header, rows } = parseCsv(await readFile(file, "utf8"));
  for (const column of ["lineId", "full"]) {
    if (!header.includes(column)) {
      console.error(`error: ${file} has no "${column}" column. Start from:  make lore-sheet LOCALE=${lang}`);
      process.exit(1);
    }
  }

  const entries = [];
  let blank = 0;
  const seen = new Set();
  for (const row of rows) {
    const lineId = row.lineId.trim();
    const full = row.full.trim();
    if (!lineId) continue;
    if (seen.has(lineId)) {
      console.error(`error: ${lineId} appears twice in ${file}; which one is meant?`);
      process.exit(1);
    }
    seen.add(lineId);
    if (!full) {
      blank++;
      continue;
    }
    entries.push({ lineId, full, short: (row.short ?? "").trim() });
  }

  console.log(`${file}: ${rows.length} rows, ${entries.length} translated, ${blank} still blank`);

  if (dryRun) {
    // What recordTranslations would decide, worked out the same way but written
    // nowhere: which are new, which are changed, which are unchanged, which are held.
    const [english, current] = await Promise.all([readCurrent(BASE_LOCALE), readCurrent(lang)]);
    const known = new Set(english.map((r) => r.lineId));
    const live = new Map(current.map((r) => [r.lineId, r]));
    const tally = { new: 0, changed: 0, unchanged: 0, heldBack: 0, unknown: [] };
    for (const entry of entries) {
      if (!known.has(entry.lineId)) {
        tally.unknown.push(entry.lineId);
        continue;
      }
      const row = live.get(entry.lineId);
      if (!row) tally.new++;
      else if (row.full === entry.full && (!entry.short || row.short === entry.short)) tally.unchanged++;
      else if (row.origin === "edited") tally.heldBack++;
      else tally.changed++;
    }
    console.log(
      `would record: ${tally.new} new, ${tally.changed} changed, ${tally.unchanged} unchanged, ` +
        `${tally.heldBack} held back behind a hand edit`,
    );
    reportUnknown(tally.unknown);
    console.log("\nThis was a dry run. Re-run without --dry-run to record.");
    return;
  }

  const stats = await recordTranslations(entries, lang);
  console.log(
    `recorded ${stats.inserted} version(s): ${stats.promoted} replaced an earlier translation, ` +
      `${stats.unchanged} unchanged, ${stats.heldBack} held back behind a hand edit`,
  );
  reportUnknown(stats.unknown);
  if (stats.inserted > 0) {
    console.log(`\nnext:  make lore-export LOCALE=${lang} && make languages`);
  }
}

function reportUnknown(ids) {
  if (ids.length === 0) return;
  console.log(`\n${ids.length} lineId(s) are not in the English corpus and were not recorded:`);
  for (const id of ids.slice(0, 20)) console.log(`  ${id}`);
  if (ids.length > 20) console.log(`  ... and ${ids.length - 20} more`);
}

try {
  await main();
} finally {
  await close();
}
