// Where audio and its manifest live, and how the manifest is read and written.
//
// Separate from generate.mjs so build-lookup.mjs can share it: importing a module
// whose top level runs a CLI would run that CLI.

import { readFile, writeFile } from "node:fs/promises";
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

// Sorted, so a run that adds one line produces a one-line diff rather than a
// reshuffled file.
export async function saveManifest(manifest) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(MANIFEST_PATH, JSON.stringify(ordered, null, 2) + "\n");
}
