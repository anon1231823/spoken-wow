#!/usr/bin/env node
// Retires audio for places the Classic Era client cannot report.
//
//   node tools/voice/retire-era.mjs            # list what would go, touch nothing
//   node tools/voice/retire-era.mjs --apply
//
// The wiki's subzone categories fed the corpus places from every era of the
// game, and the voice pipeline dutifully paid for all of them. The scrape and
// the export now filter against tools/seed/era-areas.json, which stops the
// spend going forward; this claws back what already shipped: the takes flip to
// non-current in the take table and the masters move to audio-history/, the
// same reversible retirement a re-roll performs. Nothing is deleted -- the
// takes were paid for, and restoreTake puts any of them back without a second
// purchase.
//
// Run `make lookup` afterwards to re-export the manifest and rebuild Sounds.lua.
//
// Database mode only: the manifest is an export of the take table, so pruning
// the file alone would be undone by the next export.

import { loadEraAreas } from "../lib/era.mjs";
import { loadEnvFile } from "../lib/env.mjs";
import * as db from "./db.mjs";
import { LANG, archiveAudio, loadManifest } from "./store.mjs";

// Before anything reads DATABASE_URL.
await loadEnvFile();

const apply = process.argv.includes("--apply");

async function main() {
  if (!db.isEnabled()) {
    console.error("error: DATABASE_URL is not set. The manifest is exported from");
    console.error("       the take table, so retiring has to happen there.");
    process.exit(1);
  }

  const era = await loadEraAreas();
  const manifest = await loadManifest();

  const targets = Object.entries(manifest)
    .filter(([id]) => id.startsWith("s:"))
    .map(([id, record]) => ({ id, key: id.split(":").slice(2).join(":"), record }))
    .filter(({ key }) => !era.keys.has(key));

  const bytes = targets.reduce((sum, t) => sum + Number(t.record.bytes || 0), 0);
  const credits = targets.reduce((sum, t) => sum + Number(t.record.credits || 0), 0);

  console.log(
    `${targets.length} of ${Object.keys(manifest).length} current takes are for places ` +
      `not in the Era client (build ${era.build})`,
  );
  console.log(
    `${(bytes / 1024 / 1024).toFixed(1)} MB of masters, ${credits} credits already spent\n`,
  );
  for (const t of targets) console.log(`  ${t.record.file}`);

  if (!apply) {
    console.log(`\ndry run -- retire these with:  node tools/voice/retire-era.mjs --apply`);
    return;
  }

  // Scoped to the language whose manifest picked the targets: without the lang
  // filter this would demote every language's take for these lineIds while
  // archiving only this language's masters -- the other languages' audio would
  // be lost with no audio-history entry to restore it from.
  await db.query(
    `update "take" set "isCurrent" = false
      where "source" = 'zones' and "isCurrent" and "lang" = $2 and "lineId" = any($1)`,
    [targets.map((t) => t.id), LANG],
  );

  let archived = 0;
  let missing = 0;
  for (const t of targets) {
    (await archiveAudio(t.record.file)) ? archived++ : missing++;
  }

  console.log(`\nretired ${targets.length} takes: ${archived} masters moved to audio-history/`);
  if (missing) console.log(`${missing} had no file on disk (already moved or never pulled)`);
  console.log("\nnext:  make lookup   (re-exports the manifest, rebuilds Sounds.lua)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(db.close);
