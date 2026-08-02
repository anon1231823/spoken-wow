#!/usr/bin/env node
//
// voiceline_take -> tools/voice/manifest.json
//
//   node tools/voice/export-manifest.mjs
//   node tools/voice/export-manifest.mjs --check    (exit 1 if the file is out of date)
//
// The manifest stops being hand-maintained and starts being an export. Its shape does
// not change, it stays committed, and build-lookup.mjs / validate-audio.mjs /
// package-audio.sh keep reading it -- so the addon pipeline never learns the database
// exists, and a clone with no Postgres can still ship the addon.
//
// Run after any generation, before build-lookup.mjs. `make lookup` does both.
//
// THE ROUND TRIP IS THE PROOF. import-manifest.mjs followed by this script must leave
// tools/voice/manifest.json byte-identical. If it does not, the database is not
// carrying everything the addon needs and nothing built on top of it can be trusted.
// That is what --check is for, and what the M8 verification step runs.

import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as db from "./db.mjs";
import { loadManifest, MANIFEST_PATH } from "./store.mjs";

// The same serialisation writeManifestFile uses: sorted keys, two-space indent,
// trailing newline. Duplicated deliberately rather than exported from store.mjs --
// this script's whole job is to produce that exact text, so it should say so.
function serialise(manifest) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(ordered, null, 2) + "\n";
}

async function main() {
  const check = process.argv.includes("--check");

  // Not an error, and deliberately so: `make lookup` runs this before build-lookup.mjs,
  // and with no database the manifest is already the record rather than a stale copy of
  // one. Failing here would make the whole addon build require Postgres, which is the
  // opposite of what this seam is for.
  if (!db.isEnabled()) {
    console.log("DATABASE_URL is not set; tools/voice/manifest.json is already the record.");
    return;
  }

  const manifest = await loadManifest();
  const next = serialise(manifest);
  const current = await readFile(MANIFEST_PATH, "utf8").catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });

  const count = Object.keys(manifest).length;

  if (current === next) {
    console.log(`${MANIFEST_PATH} is up to date (${count} lines).`);
    return;
  }

  if (check) {
    console.error(`error: ${MANIFEST_PATH} does not match the database.`);
    console.error("       run:  node tools/voice/export-manifest.mjs");
    process.exit(1);
  }

  // Temp file and rename, for the reason store.mjs gives: this is the record of
  // everything already paid for, and a crash partway through a write would destroy it.
  const temp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  await writeFile(temp, next);
  await rename(temp, MANIFEST_PATH);

  const before = current === null ? 0 : Object.keys(JSON.parse(current)).length;
  console.log(`wrote ${MANIFEST_PATH}`);
  console.log(`  ${count} lines (was ${before})`);
  console.log("\nnext:  node tools/voice/build-lookup.mjs");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
