// Where audio and its manifest live, and how the manifest is read and written.
//
// Separate from generate.mjs so build-lookup.mjs can share it: importing a module
// whose top level runs a CLI would run that CLI.

import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "../lib/loredata.mjs";

export const MANIFEST_PATH = join(ROOT, "tools/voice/manifest.json");
export const SOUNDS_DIR = join(ROOT, "addon/ZoneLoreAudio/Sounds");
export const SAMPLES_DIR = join(ROOT, "audio-samples");

export async function loadManifest() {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

// Serialised, because every worker saves after every line it finishes and two
// concurrent writers on one path interleave into invalid JSON. The chain is only
// ever extended, so a failed save cannot stall the ones behind it.
let saveChain = Promise.resolve();

export function saveManifest(manifest) {
  const mine = saveChain.then(
    () => writeManifest(manifest),
    () => writeManifest(manifest),
  );
  saveChain = mine.catch(() => {});
  return mine;
}

// Sorted, so a run that adds one line produces a one-line diff rather than a
// reshuffled file. Written beside the target and renamed: a crash partway
// through a write would otherwise destroy the record of everything already paid
// for, which is the one file here that cannot be regenerated.
async function writeManifest(manifest) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  const temp = `${MANIFEST_PATH}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(ordered, null, 2) + "\n");
  await rename(temp, MANIFEST_PATH);
}
