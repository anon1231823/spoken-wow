#!/usr/bin/env node
//
// Checks that the manifest, the files on disk, the generated lookup table and the
// lore data all still agree.
//
// This is the failure worth catching here: a lookup row pointing at a file that
// is not there plays silence in-game and reports nothing. Every other kind of
// mistake announces itself.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readdir } from "node:fs/promises";

import { ROOT, readLines } from "../lib/loredata.mjs";
import { apiKey, downloadDictionary, loadConfig, resolveDictionary } from "./elevenlabs.mjs";
import { parseDictionary, uncoveredSpellings } from "./lexicon.mjs";
import { assignFiles, lineId } from "./naming.mjs";
import { hasBrackets, loadPronunciation, toSpokenText } from "./normalise.mjs";
import { loadManifest, SOUNDS_DIR } from "./store.mjs";

const LOOKUP_PATH = join(ROOT, "addon/ZoneLoreAudio/Data/Sounds.lua");

const problems = [];
const notes = [];

function problem(text) { problems.push(text); }
function note(text) { notes.push(text); }

async function mp3sOnDisk(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) found.push(...(await mp3sOnDisk(join(dir, item.name), rel)));
    else if (item.name.endsWith(".mp3")) found.push(rel.replace(/\.mp3$/, ""));
  }
  return found;
}

/**
 * Names the shared lexicon knows, spelled here in a way none of its rules match.
 *
 * A note rather than a problem, and skipped rather than failed when there is no
 * key or no pinned dictionary: this is the only check here that needs the
 * network, and `make check` has to keep working on a machine with no
 * credentials. What it finds is not broken data either -- it is a pronunciation
 * that will come out wrong, and the fix is an entry in ../wow-voiceover's
 * /lexicon, which is not something this run can do.
 */
async function checkDictionary(spokenTexts) {
  const config = await loadConfig().catch(() => null);
  if (!config?.dictionaryId) {
    note("no pronunciation dictionary is named in tools/voice/config.json; coverage unchecked");
    return;
  }

  let pls;
  try {
    const key = await apiKey();
    await resolveDictionary(config, key);
    pls = await downloadDictionary(config, key);
  } catch (err) {
    note(`pronunciation dictionary not checked: ${err.message.slice(0, 120)}`);
    return;
  }

  const uncovered = uncoveredSpellings(parseDictionary(pls), spokenTexts);
  if (!uncovered.length) return;

  const worst = uncovered.slice(0, 5).map((row) => `${row.spelling} (${row.occurrences})`);
  note(
    `${uncovered.length} spelling(s) of a lexicon name have no rule that matches them: ` +
      `${worst.join(", ")}${uncovered.length > 5 ? ", ..." : ""}. ` +
      "A phoneme rule is case-sensitive and wow-voiceover derives its spellings from its own " +
      "corpus, so add these in that project's /lexicon.",
  );
}

async function main() {
  const entries = await readLines();
  const rules = await loadPronunciation();
  const files = assignFiles(entries);
  const manifest = await loadManifest();

  //-- the spoken text is safe for v3 ----------------------------------------
  let bracketed = 0;
  for (const entry of entries) {
    if (hasBrackets(toSpokenText(entry.full, rules))) bracketed++;
  }
  if (bracketed) {
    problem(`${bracketed} lines still contain square brackets after normalising; `
      + "Eleven v3 reads those as performance directions");
  }

  //-- the shared lexicon covers this project's spellings ---------------------
  await checkDictionary(entries.map((e) => toSpokenText(e.full, rules)));

  //-- file paths are unique -------------------------------------------------
  const byFile = new Map();
  for (const [id, file] of files) {
    if (byFile.has(file)) problem(`file collision: ${byFile.get(file)} and ${id} both map to ${file}`);
    byFile.set(file, id);
  }

  //-- manifest vs disk ------------------------------------------------------
  const onDisk = new Set(await mp3sOnDisk(SOUNDS_DIR));
  const manifestFiles = new Set(Object.values(manifest).map((r) => r.file));

  for (const [id, record] of Object.entries(manifest)) {
    if (!onDisk.has(record.file)) problem(`${id}: manifest says ${record.file}.mp3, which is not on disk`);
    if (!files.has(id)) problem(`${id}: in the manifest but no longer in the lore data`);
  }
  for (const file of onDisk) {
    if (!manifestFiles.has(file)) note(`${file}.mp3 is on disk with no manifest entry (orphan)`);
  }

  //-- lookup table vs disk --------------------------------------------------
  if (existsSync(LOOKUP_PATH)) {
    const lookup = await readFile(LOOKUP_PATH, "utf8");
    // The table stores WoW-style backslash paths (escaped in Lua source); the
    // files on disk are POSIX. Compare in one form.
    const referenced = [...lookup.matchAll(/file = "([^"]+)"/g)].map((m) =>
      m[1].replace(/\\\\/g, "/").replace(/\\/g, "/"),
    );
    for (const file of referenced) {
      if (!onDisk.has(file)) problem(`lookup table points at ${file}.mp3, which is not on disk (plays silence)`);
    }
    const missingFromLookup = [...manifestFiles].filter((f) => !referenced.includes(f));
    if (missingFromLookup.length) {
      problem(`${missingFromLookup.length} generated files are not in the lookup table `
        + "(unreachable in-game) -- run node tools/voice/build-lookup.mjs");
    }

    // Keys in the table must be exactly what ZoneLore:NormaliseAreaKey produces,
    // or the lookup silently misses.
    const validKeys = new Set(entries.filter((e) => e.key).map((e) => `${e.mapID}:${e.key}`));
    let currentMap = null;
    for (const line of lookup.split("\n")) {
      const zoneHeader = line.match(/^\t\t\[(\d+)\] = \{$/);
      if (zoneHeader) { currentMap = zoneHeader[1]; continue; }
      const keyRow = line.match(/^\t\t\t\["([^"]+)"\]/);
      if (keyRow && currentMap && !validKeys.has(`${currentMap}:${keyRow[1]}`)) {
        problem(`lookup key "${keyRow[1]}" under ${currentMap} matches no subzone in the lore data`);
      }
    }
  } else if (Object.keys(manifest).length) {
    problem("audio has been generated but no lookup table exists -- run node tools/voice/build-lookup.mjs");
  }

  //-- report ----------------------------------------------------------------
  const total = Object.keys(manifest).length;
  if (problems.length === 0) {
    console.log(`OK -- ${total} generated, ${onDisk.size} files on disk, lookup in step`);
    for (const text of notes) console.log(`     note: ${text}`);
    return;
  }

  console.error(`FAILED -- ${problems.length} problem(s)`);
  for (const text of problems.slice(0, 20)) console.error(`  ${text}`);
  if (problems.length > 20) console.error(`  ... and ${problems.length - 20} more`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(1);
});
