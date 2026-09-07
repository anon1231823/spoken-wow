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

import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile } from "../lib/env.mjs";
import { readLines } from "../lib/loredata.mjs";
import { assignFiles, lineId, textHash } from "./naming.mjs";
import { hasBrackets, loadPronunciation, toSpokenText } from "./normalise.mjs";
import {
  apiKey,
  fetchTier,
  loadConfig,
  resolveDictionary,
  resolveVoiceId,
  synthesize,
} from "./elevenlabs.mjs";
// writeAudio lives in store.mjs rather than here because it archives the take it
// replaces, and the only correct moment for that is between "the replacement exists"
// and "it lands on the old take's path" -- which is inside the write, not around it.
import {
  close as closeStore,
  durationOf,
  loadManifest,
  saveManifest,
  writeAudio,
  SAMPLES_DIR,
  soundsDir,
  LANG,
} from "./store.mjs";
import { afterRateLimit, budgetFor, COOL_DOWN_MS, Limiter } from "./concurrency.mjs";

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
    dictionaryDrift: false,
    olderThan: null,
    all: false,
    limit: null,
    generate: false,
    force: false,
    sample: false,
    concurrency: null,
    list: false,
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
      case "--dictionary-drift": args.dictionaryDrift = true; break;
      case "--older-than": args.olderThan = next(); break;
      case "--all": args.all = true; break;
      case "--limit": args.limit = Number(next()); break;
      case "--generate": args.generate = true; break;
      case "--force": args.force = true; break;
      case "--sample": args.sample = true; break;
      case "--concurrency": args.concurrency = Number(next()); break;
      case "--list": args.list = true; break;
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
  --dictionary-drift   spoken with a pronunciation dictionary other than the
                       one config.json pins. Never implied by --stale: a
                       lexicon change does not alter the text, so these lines
                       are only worth re-cutting deliberately
  --older-than <date>  generated before this ISO date
  --all                every entry
  --limit <n>          cap the selection

Actions:
  (default)            dry run: counts, characters, credits, minutes
  --generate           call ElevenLabs and write the audio
  --force              regenerate entries that already have audio
  --sample             two representative lines into audio-samples/, for
                       checking the voice before committing to a bulk run
  --concurrency <n>    override the per-plan request budget
  --list               list every selected line, however many (a selection of
                       %d or fewer lists itself)
`.replace("%d", String(AUTO_LIST_LIMIT)));
}

//------------------------------------------------------------------------------
// Selection
//------------------------------------------------------------------------------

export async function buildCatalogue() {
  const entries = await readLines(LANG);
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

// Whether a line's audio was made with a pronunciation dictionary other than the
// latest version, resolved for this run.
//
// This is the only way a lexicon change is visible here. The lexicon lives in
// ../wow-voiceover and reaches this project as dictionary rules, which the model
// applies to text this project never rewrites -- so the spoken text, and the hash
// --stale compares, do not move when a pronunciation is fixed.
//
// False when no version has been resolved, because "unknown" and "changed" are not
// the same thing and only the second is worth spending credits on.
export function driftsFromDictionary(record, config) {
  if (!record || !config?.dictionaryId || !config?.dictionaryVersionId) return false;
  return (
    record.dictionaryId !== config.dictionaryId ||
    record.dictionaryVersionId !== config.dictionaryVersionId
  );
}

export function select(catalogue, args, manifest, config = {}) {
  let out = catalogue;

  if (args.zones.length) out = out.filter((e) => matchesZone(e, args.zones));
  if (args.zonesOnly) out = out.filter((e) => e.kind === "zone");
  if (args.subzonesOnly) out = out.filter((e) => e.kind === "subzone");

  const conditions = [];
  if (args.missing) conditions.push((e) => !manifest[e.id]);
  if (args.stale) conditions.push((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash);
  // Never implied by --stale, and never automatic. Adopting a shared dictionary
  // drifts all 1353 lines at once, and re-cutting them is a four-figure credit
  // decision that belongs to whoever is reading the number, not to this flag.
  if (args.dictionaryDrift) {
    conditions.push((e) => driftsFromDictionary(manifest[e.id], config));
  }
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

// A zone and its subzones is the natural unit of work here and fits on a screen,
// so a selection that size lists itself. --all does not, unless --list says so.
const AUTO_LIST_LIMIT = 60;

// Below this, Eleven v3 is documented as unreliable, and 305 of the 1353 entries
// are shorter -- so the ones to listen to first are worth marking.
const SHORT_LINE = 250;

function listSelection(selected, manifest, config, args) {
  if (!args.list && selected.length > AUTO_LIST_LIMIT) {
    console.log(`(${selected.length} lines; --list to see them all)\n`);
    return;
  }

  // Largest first: those are what the run costs, and what is worth checking.
  const rows = [...selected].sort((a, b) => b.spoken.length - a.spoken.length);
  const { creditRate: rate } = measureRates(manifest, config);
  const width = String(rows[0].spoken.length).length;

  console.log(`${rows.length} lines, largest first:\n`);
  for (const entry of rows) {
    const record = manifest[entry.id];
    const state = !record ? "new" : record.textHash !== entry.hash ? "stale" : "current";
    const credits = rate ? `~${String(Math.round(entry.spoken.length * rate)).padStart(width)}cr` : "";
    const short = entry.spoken.length < SHORT_LINE ? " short" : "";

    console.log(
      `  ${String(entry.spoken.length).padStart(width)}ch ${credits}  ` +
        `${state.padEnd(7)} ${(entry.name || entry.key || entry.zoneName).padEnd(34)} ${entry.file}${short}`,
    );
  }

  const shortCount = rows.filter((e) => e.spoken.length < SHORT_LINE).length;
  if (shortCount) {
    console.log(`\n  ${shortCount} under ${SHORT_LINE} characters (marked "short"): `
      + "v3 is least reliable there, so listen to those first.");
  }
  console.log("");
}

// Credits per character and characters per second, measured from what has
// already been generated rather than assumed.
//
// Both were constants first, and both were wrong: 0.55 and 15 against a measured
// 0.61 and 12.9, which is a 10% understatement of the bill and of the runtime.
// Every generated line records what it actually cost and how long it came out, so
// the estimate should come from that and improve as the corpus fills. The config
// values remain the answer for a manifest with nothing in it yet.
export function measureRates(manifest, config) {
  let chars = 0, credits = 0, seconds = 0, counted = 0;

  for (const record of Object.values(manifest)) {
    if (typeof record.credits !== "number" || typeof record.chars !== "number") continue;
    chars += record.chars;
    credits += record.credits;
    if (typeof record.durationSec === "number") seconds += record.durationSec;
    counted++;
  }

  if (counted === 0 || chars === 0) {
    return {
      creditRate: config?.creditRate ?? null,
      charsPerSecond: 15,
      measuredFrom: 0,
    };
  }

  return {
    creditRate: credits / chars,
    charsPerSecond: seconds > 0 ? chars / seconds : 15,
    measuredFrom: counted,
  };
}

function summarise(selected, manifest, label, config) {
  const chars = selected.reduce((n, e) => n + e.spoken.length, 0);
  const missing = selected.filter((e) => !manifest[e.id]).length;
  const stale = selected.filter((e) => manifest[e.id] && manifest[e.id].textHash !== e.hash).length;

  const { creditRate, charsPerSecond, measuredFrom } = measureRates(manifest, config);
  const credits = creditRate ? Math.round(chars * creditRate) : null;
  const source = measuredFrom
    ? `measured over ${measuredFrom} generated line${measuredFrom === 1 ? "" : "s"}`
    : "estimated from config.json";

  console.log(`${label}: ${selected.length} lines`);
  console.log(`  characters : ${chars.toLocaleString()}`);
  console.log(
    credits === null
      ? "  credits    : unknown (set creditRate in tools/voice/config.json)"
      : `  credits    : ~${credits.toLocaleString()} at ${creditRate.toFixed(3)}/char, ${source}`,
  );
  console.log(`  audio      : ~${Math.round(chars / charsPerSecond / 60)} minutes at ${charsPerSecond.toFixed(1)} chars/second`);
  console.log(`  state      : ${missing} missing, ${stale} stale, ${selected.length - missing - stale} already current`);

  // Reported, never acted on. A dictionary change does not move the text hash, so
  // none of these lines count as stale and none of them are selected unless
  // --dictionary-drift asks for them by name.
  const drifted = selected.filter((e) => driftsFromDictionary(manifest[e.id], config)).length;
  if (drifted) {
    console.log(
      `  dictionary : ${drifted} spoken with an older pronunciation dictionary ` +
        "(--dictionary-drift selects them)",
    );
  }
}

//------------------------------------------------------------------------------
// Audio
//------------------------------------------------------------------------------

//------------------------------------------------------------------------------
// Generation
//------------------------------------------------------------------------------

async function generate(selected, args) {
  const config = await loadConfig(LANG);
  const key = await apiKey();
  await resolveVoiceId(config, key, LANG);
  await resolveDictionary(config, key);

  const manifest = await loadManifest();
  let done = 0, skipped = 0, failed = 0, characters = 0, credits = 0, creditsKnown = true;

  // The plan's published limit, unless overridden. Asking the account beats a
  // constant: the same script on a Creator key and a Scale key wants 5 and 15.
  const tier = args.concurrency ? null : await fetchTier(key);
  const budget = args.concurrency ?? budgetFor(tier, config.modelId);
  const limiter = new Limiter(budget);

  console.log(
    args.concurrency
      ? `concurrency ${budget} (from --concurrency)`
      : `concurrency ${budget} (${tier ?? "unknown"} plan, ${config.modelId})`,
  );

  // A 429 means the published number is wrong right now -- another process on the
  // same key, or a limit that moved. Halve and stay halved for a minute rather
  // than retrying into a wall.
  let rateLimitedAt = null;
  const onRateLimit = () => {
    const first = rateLimitedAt === null || Date.now() - rateLimitedAt > COOL_DOWN_MS;
    rateLimitedAt = Date.now();
    const reduced = afterRateLimit(budget, rateLimitedAt, Date.now());
    limiter.setLimit(reduced);
    if (first) console.log(`  rate limited -- dropping to ${reduced} for ${COOL_DOWN_MS / 1000}s`);
    setTimeout(() => {
      if (Date.now() - rateLimitedAt >= COOL_DOWN_MS) limiter.setLimit(budget);
    }, COOL_DOWN_MS + 100).unref();
  };

  const tasks = selected.map((entry) =>
    limiter.run(async () => {
      // Audio already generated cost real money, and a re-roll is not always an
      // improvement. ../wow-voiceover/tts_cli/synthesize.py refuses for the same
      // reason.
      if (existsSync(join(soundsDir(LANG), `${entry.file}.mp3`)) && !args.force) {
        skipped++;
        return;
      }

      try {
        const { audio, credits: cost } = await synthesize(entry.spoken, config, key, { onRateLimit });
        // Archives whatever this replaces, which is what makes --force reversible.
        const path = await writeAudio(entry.file, audio);

        manifest[entry.id] = {
          file: entry.file,
          textHash: entry.hash,
          chars: entry.spoken.length,
          // What ElevenLabs actually charged, not what the text length implies.
          credits: cost,
          durationSec: await durationOf(path),
          bytes: (await stat(path)).size,
          voiceId: config.voiceId,
          modelId: config.modelId,
          outputFormat: config.outputFormat,
          // Recorded so a line's pronunciation can be explained later, and so a
          // dictionary change can be told apart from a text change.
          dictionaryId: config.dictionaryId ?? null,
          dictionaryVersionId: config.dictionaryVersionId ?? null,
          generatedAt: new Date().toISOString(),
        };
        // Written after every line, so an interrupted run keeps everything
        // already paid for.
        await saveManifest(manifest);

        done++;
        characters += entry.spoken.length;
        if (cost === null) creditsKnown = false;
        else credits += cost;

        console.log(
          `  ok  ${entry.id}  ${entry.spoken.length} chars` +
            `${cost === null ? "" : `, ${cost} credits`}  -> ${entry.file}.mp3`,
        );
      } catch (err) {
        failed++;
        console.error(`  FAIL ${entry.id}: ${err.message}`);
      }
    }),
  );

  await Promise.all(tasks);

  console.log(`\ngenerated ${done}, skipped ${skipped} (already present), failed ${failed}`);
  console.log(
    `${characters.toLocaleString()} characters` +
      (creditsKnown
        ? `, ${credits.toLocaleString()} credits (billed, from the character-cost header)`
        : ", credits unknown (ElevenLabs sent no character-cost header)"),
  );
  if (done > 0) console.log("\nnext:  node tools/voice/build-lookup.mjs");
  if (failed > 0) process.exitCode = 1;
}

// One long zone and one short subzone: the two cases with different risks. v3 is
// documented as unreliable below ~250 characters, and 302 of the 1353 entries are
// shorter than that, so the short one is the honest test.
async function sample(catalogue) {
  const config = await loadConfig(LANG);
  const key = await apiKey();
  await resolveVoiceId(config, key, LANG);
  await resolveDictionary(config, key);

  const long = catalogue
    .filter((e) => e.kind === "zone")
    .sort((a, b) => b.spoken.length - a.spoken.length)[0];
  const short = catalogue
    .filter((e) => e.kind === "subzone" && e.spoken.length < 250)
    .sort((a, b) => a.spoken.length - b.spoken.length)[0];

  await mkdir(SAMPLES_DIR, { recursive: true });

  for (const entry of [long, short].filter(Boolean)) {
    // Samples go straight to disk, not through writeAudio: they live outside the
    // store, are never recorded as takes, and archiving one would be meaningless.
    const path = join(SAMPLES_DIR, `${entry.id.replace(/[:\s]/g, "_")}.mp3`);
    console.log(`sampling ${entry.id} (${entry.spoken.length} chars) -> ${path}`);
    const { audio, credits } = await synthesize(entry.spoken, config, key);
    await writeFile(path, audio);
    console.log(`  ${await durationOf(path)}s${credits === null ? "" : `, ${credits} credits`}`);
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
  // Loaded even for a dry run, which needs the credit rate to estimate a cost.
  const config = await loadConfig(LANG);

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
    args.missing || args.stale || args.dictionaryDrift || args.olderThan;

  if (!anySelector) {
    usage();
    console.error("error: pick a selector (--all is the everything one).");
    process.exit(1);
  }

  // Only for the flag that cannot work without it. Every other dry run stays
  // offline and needs no key, which is what makes the cost of a run checkable
  // from a laptop with no credentials.
  if (args.dictionaryDrift && config.dictionaryId && !config.dictionaryVersionId) {
    await resolveDictionary(config, await apiKey());
  }

  const selected = select(catalogue, args, manifest, config);
  if (selected.length === 0) {
    console.log("nothing selected.");
    return;
  }

  if (!args.generate) {
    listSelection(selected, manifest, config, args);
    summarise(selected, manifest, "would generate", config);
    console.log("\nThis was a dry run. Add --generate to spend credits.");
    return;
  }

  summarise(selected, manifest, "generating", config);
  console.log("");
  await generate(selected, args);
}

// Only when run as a script. buildCatalogue and select are imported by
// validate.mjs and by tests, and a module that runs a CLI on import would run it
// for them too.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // .env bridged in the CLI guard only; the explorer imports this module.
  loadEnvFile()
    .then(main)
    .catch((err) => {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
    })
    // An open connection pool keeps the process alive after main() returns, which
    // looks exactly like a hang. Harmless with DATABASE_URL unset.
    .finally(() => closeStore());
}
