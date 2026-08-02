#!/usr/bin/env node
//
// tools/voice/manifest.json -> voiceline_take, once.
//
//   node tools/voice/import-manifest.mjs
//   node tools/voice/import-manifest.mjs --dry-run
//
// Seeds the database from the record that existed before it did. Every manifest entry
// becomes version 1, origin 'imported': audio that predates this app, whose voice
// settings are unknowable because the manifest never stored them.
//
// IDEMPOTENT BY LINE, not by row. A line that already has any take is left completely
// alone -- not updated, not re-versioned. Re-running after a generation run therefore
// picks up only what is genuinely new, and can never demote a real take to an imported
// one or overwrite the settings of something this app actually made.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as db from "./db.mjs";
import { insertTake, MANIFEST_PATH } from "./store.mjs";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (!db.isEnabled()) {
    console.error("error: DATABASE_URL is not set -- there is nothing to import into.");
    console.error("       start it with:  docker compose up -d && ./scripts/migrate.sh");
    process.exit(1);
  }

  const manifest = await readManifestFile();
  const ids = Object.keys(manifest);
  if (ids.length === 0) {
    console.log(`${MANIFEST_PATH} is empty; nothing to import.`);
    return;
  }

  const { rows } = await db.query(`select distinct "lineId" from "voiceline_take"`);
  const known = new Set(rows.map((row) => row.lineId));

  const fresh = ids.filter((id) => !known.has(id));
  const already = ids.length - fresh.length;

  console.log(`${MANIFEST_PATH}`);
  console.log(`  ${ids.length} entries, ${fresh.length} to import, ${already} already known`);

  if (dryRun) {
    for (const id of fresh.slice(0, 10)) console.log(`    ${id}  ${manifest[id].file}`);
    if (fresh.length > 10) console.log(`    ... and ${fresh.length - 10} more`);
    console.log("\nThis was a dry run. Re-run without --dry-run to import.");
    return;
  }

  let imported = 0;
  for (const id of fresh) {
    // settings stays null: the manifest never recorded what voiceSettings a line was
    // made with, and inventing today's config for a clip cut weeks ago would be a
    // reproducible-looking lie.
    await insertTake(id, manifest[id], "imported", null);
    imported++;
    if (imported % 100 === 0) console.log(`  ${imported}/${fresh.length}`);
  }

  console.log(`imported ${imported} take(s) at version 1.`);
  if (imported > 0) console.log("\nnext:  node tools/voice/export-manifest.mjs   (the round trip must be a no-op)");
}

// Read the file directly rather than through store.mjs's loadManifest, which in
// database mode reads the database and would report the import as already done.
async function readManifestFile() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
