#!/usr/bin/env node
//
// Selects lore lines and, on request, synthesizes them into the audio addon.
//
//   node tools/voice/generate.mjs --all                 dry run over everything
//   node tools/voice/generate.mjs --zone Durotar        dry run over one zone
//   node tools/voice/generate.mjs --zone Durotar --generate
//
// Dry run is the default because the direction that cannot be undone is spending
// money, not printing. --generate without a selector refuses to run.

import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readLines } from "../lib/loredata.mjs";
import { assignFiles, lineId, textHash } from "./naming.mjs";
import { hasBrackets, loadPronunciation, toSpokenText } from "./normalise.mjs";
import { apiKey, loadConfig, resolveVoiceId, synthesize } from "./elevenlabs.mjs";
import { loadManifest, saveManifest, SAMPLES_DIR, SOUNDS_DIR } from "./store.mjs";

const execFileAsync = promisify(execFile);

const CONCURRENCY = 3;

//------------------------------------------------------------------------------
// Arguments
//------------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    zones: [],
    zonesOnly: false,
    subzonesOnly: false,
    missing: false,
    stale: false,
    olderThan: null,
    all: false,
    limit: null,
    generate: false,
    force: false,
    sample: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case "--zone": args.zones.push(next()); break;
      case "--zones-only": args.zonesOnly = true; break;
      case "--subzones-only": args.subzonesOnly = true; break;
      case "--missing": args.missing = true; break;
      case "--stale": args.stale = true; break;
      case "--older-than": args.olderThan = next(); break;
      case "--all": args.all = true; break;
      case "--limit": args.limit = Number(next()); break;
      case "--generate": args.generate = true; break;
      case "--force": args.force = true; break;
      case "--sample": args.sample = true; break;
      case "--help": case "-h": usage(); process.exit(0);
      default: throw new Error(`unknown argument ${arg} (try --help)`);
    }
  }
  return args;
}

function usage() {
  console.log(`Usage: node tools/voice/generate.mjs [selectors] [--generate]

Selectors (combine freely; a zone selects its subzones too):
  --zone <id|name>     repeatable, e.g. --zone 1411 --zone "The Barrens"
  --zones-only         zone entries, no subzones
  --subzones-only      subzone entries only
  --missing            no audio yet
  --stale              spoken text changed since it was generated
  --older-than <date>  generated before this ISO date
  --all                every entry
  --limit <n>          cap the selection

Actions:
  (default)            dry run: counts, characters, credits, minutes
  --generate           call ElevenLabs and write the audio
  --force              regenerate entries that already have audio
  --sample             two representative lines into audio-samples/, for
                       checking the voice before committing to a bulk run
`);
}

//------------------------------------------------------------------------------
// Selection
//------------------------------------------------------------------------------

export async function buildCatalogue() {
  const entries = await readLines();
  const rules = await loadPronunciation();
  const files = assignFiles(entries);

  // Subzones carry only their parent's uiMapID, so --zone Durotar needs the zone
  // name attached to every entry for the name form of the selector to reach them.
  const zoneNames = new Map(
    entries.filter((e) => e.kind === "zone").map((e) => [e.mapID, e.name]),
  );

  return entries.map((entry) => {
    const spoken = toSpokenText(entry.full, rules);
    return {
      ...entry,
      zoneName: zoneNames.get(entry.mapID) ?? "",
      id: lineId(entry),
      file: files.get(lineId(entry)),
      spoken,
      hash: textHash(spoken),
    };
  });
}

function matchesZone(entry, zones) {
  return zones.some((wanted) => {
    if (/^\d+$/.test(wanted)) return entry.mapID === Number(wanted);
    return normaliseName(entry.zoneName ?? "") === normaliseName(wanted);
  });
}

function normaliseName(name) {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function select(catalogue, args, manifest) {
  let out = catalogue;

  if (args.zones.length) out = out.filter((e) => matchesZone(e, args.zones));
  if (args.zonesOnly) out = out.filter((e) => e.kind === "zone");
  if (args.subzonesOnly) out = out.filter((e) => e.kind === "subzone");

  const conditions = [];
  if (args.missing) conditions.push((e) => !manifest[e.id]);
  if (args.stale) conditions.push((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash);
  if (args.olderThan) {
    const cutoff = Date.parse(args.olderThan);
    if (Number.isNaN(cutoff)) throw new Error(`--older-than: cannot parse "${args.olderThan}"`);
    conditions.push((e) => manifest[e.id] && Date.parse(manifest[e.id].generatedAt) < cutoff);
  }
  // Any of the state conditions, so --missing --stale reads as "needs work".
  if (conditions.length) out = out.filter((e) => conditions.some((fn) => fn(e)));

  if (args.limit != null) out = out.slice(0, args.limit);
  return out;
}

//------------------------------------------------------------------------------
// Reporting
//------------------------------------------------------------------------------

function summarise(selected, manifest, label) {
  const chars = selected.reduce((n, e) => n + e.spoken.length, 0);
  const missing = selected.filter((e) => !manifest[e.id]).length;
  const stale = selected.filter((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash).length;

  console.log(`${label}: ${selected.length} lines`);
  console.log(`  characters : ${chars.toLocaleString()}  (= credits; 1 per character on v3)`);
  console.log(`  audio      : ~${Math.round(chars / 15 / 60)} minutes at ~15 chars/second`);
  console.log(`  state      : ${missing} missing, ${stale} stale, ${selected.length - missing - stale} already current`);
}

//------------------------------------------------------------------------------
// Audio
//------------------------------------------------------------------------------

// ffprobe rather than parsing frame headers: the duration is what stops the
// addon's Play button resetting at the wrong moment, and a CBR assumption in a
// hand-rolled parser would be wrong silently.
async function durationOf(path) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${path}`);
  return Math.round(seconds * 1000) / 1000;
}

async function writeAudio(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  // Write beside the target and rename, so an interrupted run cannot leave a
  // truncated mp3 that later looks like a finished one.
  const temp = `${path}.part`;
  await writeFile(temp, buffer);
  await rename(temp, path);
}

//------------------------------------------------------------------------------
// Generation
//------------------------------------------------------------------------------

async function generate(selected, args) {
  const config = await loadConfig();
  const key = await apiKey();
  await resolveVoiceId(config, key);

  const manifest = await loadManifest();
  let done = 0, skipped = 0, failed = 0, characters = 0;

  const queue = [...selected];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const entry = queue.shift();
      const path = join(SOUNDS_DIR, `${entry.file}.mp3`);

      // Audio already generated cost real money, and a re-roll is not always an
      // improvement. ../wow-voiceover/tts_cli/synthesize.py refuses for the same
      // reason.
      if (existsSync(path) && !args.force) {
        skipped++;
        continue;
      }

      try {
        const audio = await synthesize(entry.spoken, config, key);
        await writeAudio(path, audio);

        manifest[entry.id] = {
          file: entry.file,
          textHash: entry.hash,
          chars: entry.spoken.length,
          durationSec: await durationOf(path),
          bytes: (await stat(path)).size,
          voiceId: config.voiceId,
          modelId: config.modelId,
          outputFormat: config.outputFormat,
          generatedAt: new Date().toISOString(),
        };
        // Written after every line, so an interrupted run keeps everything
        // already paid for.
        await saveManifest(manifest);

        done++;
        characters += entry.spoken.length;
        console.log(`  ok  ${entry.id}  ${entry.spoken.length} chars  -> ${entry.file}.mp3`);
      } catch (err) {
        failed++;
        console.error(`  FAIL ${entry.id}: ${err.message}`);
      }
    }
  });

  await Promise.all(workers);

  console.log(`\ngenerated ${done}, skipped ${skipped} (already present), failed ${failed}`);
  console.log(`spent ~${characters.toLocaleString()} characters`);
  if (done > 0) console.log("\nnext:  node tools/voice/build-lookup.mjs");
  if (failed > 0) process.exitCode = 1;
}

// One long zone and one short subzone: the two cases with different risks. v3 is
// documented as unreliable below ~250 characters, and 302 of the 1353 entries are
// shorter than that, so the short one is the honest test.
async function sample(catalogue) {
  const config = await loadConfig();
  const key = await apiKey();
  await resolveVoiceId(config, key);

  const long = catalogue
    .filter((e) => e.kind === "zone")
    .sort((a, b) => b.spoken.length - a.spoken.length)[0];
  const short = catalogue
    .filter((e) => e.kind === "subzone" && e.spoken.length < 250)
    .sort((a, b) => a.spoken.length - b.spoken.length)[0];

  await mkdir(SAMPLES_DIR, { recursive: true });

  for (const entry of [long, short].filter(Boolean)) {
    const path = join(SAMPLES_DIR, `${entry.id.replace(/[:\s]/g, "_")}.mp3`);
    console.log(`sampling ${entry.id} (${entry.spoken.length} chars) -> ${path}`);
    const audio = await synthesize(entry.spoken, config, key);
    await writeAudio(path, audio);
    console.log(`  ${await durationOf(path)}s`);
  }

  console.log(`\nListen, then set voiceSettings.stability in tools/voice/config.json`);
  console.log("and add any mispronunciations to tools/voice/pronunciation.json.");
}

//------------------------------------------------------------------------------
// Entry point
//------------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalogue = await buildCatalogue();

  // Enforced here rather than left to the model: a bracket that reaches v3 is
  // performed rather than spoken, which is silent corruption of a paid clip.
  const leaked = catalogue.filter((e) => hasBrackets(e.spoken));
  if (leaked.length) {
    console.error(`error: ${leaked.length} lines still contain square brackets after normalising.`);
    for (const entry of leaked.slice(0, 5)) console.error(`  ${entry.id}`);
    console.error("Eleven v3 reads brackets as performance directions. Fix tools/voice/normalise.mjs.");
    process.exit(1);
  }

  if (args.sample) {
    await sample(catalogue);
    return;
  }

  const manifest = await loadManifest();
  const anySelector =
    args.all || args.zones.length || args.zonesOnly || args.subzonesOnly ||
    args.missing || args.stale || args.olderThan;

  if (!anySelector) {
    usage();
    console.error("error: pick a selector (--all is the everything one).");
    process.exit(1);
  }

  const selected = select(catalogue, args, manifest);
  if (selected.length === 0) {
    console.log("nothing selected.");
    return;
  }

  if (!args.generate) {
    summarise(selected, manifest, "would generate");
    console.log("\nfirst few:");
    for (const entry of selected.slice(0, 3)) {
      console.log(`\n  ${entry.id}  (${entry.spoken.length} chars) -> ${entry.file}.mp3`);
      console.log(`  ${entry.spoken.slice(0, 220)}${entry.spoken.length > 220 ? "..." : ""}`);
    }
    console.log("\nThis was a dry run. Add --generate to spend credits.");
    return;
  }

  summarise(selected, manifest, "generating");
  console.log("");
  await generate(selected, args);
}

// Only when run as a script. buildCatalogue and select are imported by
// validate.mjs and by tests, and a module that runs a CLI on import would run it
// for them too.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`error: ${err.message}`);
    process.exit(1);
  });
}
