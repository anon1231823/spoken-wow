// Where audio and its record live, and how that record is read and written.
//
// This is the seam. generate.mjs, build-lookup.mjs and validate-audio.mjs reach the
// generation record only through loadManifest/saveManifest here, so putting Postgres
// behind those two functions gives the CLI and the web app one shared view instead of
// two that drift. ../wow-voiceover/web/migrations/0012 records what the drift costs:
// "the Python CLI reads the corpus and will not see these rows ... The web app is the
// generation path. This is recorded rather than solved."
//
// TWO MODES, ONE INTERFACE:
//
//   DATABASE_URL set    -> voiceline_take, with a row per take and a history
//   DATABASE_URL unset  -> tools/voice/manifest.json, exactly as before
//
// The file mode is not a legacy path. manifest.json stays committed and is what
// build-lookup.mjs turns into the addon's lookup table, so a clone with no Postgres
// can still generate audio and ship the addon. tools/voice/export-manifest.mjs is
// what keeps the file in step once the database is in play.

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { basename, extname } from "node:path";

import { BASE_LOCALE, isLocale, packFolder } from "../lib/locales.mjs";
import { ROOT } from "../lib/loredata.mjs";
import * as db from "./db.mjs";

const execFileAsync = promisify(execFile);

// The language this process defaults to. The CLI sets it once and never passes a
// language again -- a generation run is one language by nature. The explorer
// ignores it and passes a language per request.
export const LANG = process.env.ZONELORE_LANG || BASE_LOCALE;
if (!isLocale(LANG)) {
  throw new Error(`ZONELORE_LANG=${LANG} is not a WoW locale code`);
}

// Each of these can be overridden by an environment variable, and on the droplet each
// one is: ZONELORE_ROOT points at the current release, and these three point *outside*
// it. What they have in common is that the app writes them, so leaving them inside a
// release would mean prune.sh deleting them five deploys later. See deploy/README.md.
// Unset, which is every local run, they are exactly the repo paths they always were.
//
// EVERY PATH IS A FUNCTION OF THE LANGUAGE, not a constant. The CLI runs one
// language per process and passes nothing; the explorer serves several at once
// from a single process and passes one per request, which a module-level constant
// resolved at import could not do.
//
// The environment overrides name ENGLISH's paths -- that is what they name on the
// droplet today, where they point outside the release directory so a deploy cannot
// move ~700 MB and prune.sh cannot delete it. Another language derives its own
// path beside English's rather than ignoring the override, so one setting still
// decides where audio lives.

// tools/voice/manifest.json, or manifest.<lang>.json beside it. English keeps the
// committed name: renaming a 392 KB file buys nothing and breaks every deployment
// pointing ZONELORE_MANIFEST at it.
export function manifestPath(lang = LANG) {
  const base = process.env.ZONELORE_MANIFEST || join(ROOT, "pipelines/zones/tools/voice/manifest.json");
  if (lang === BASE_LOCALE) return base;
  const ext = extname(base);
  return join(dirname(base), `${basename(base, ext)}.${lang}${ext}`);
}

// The masters, at full bitrate, inside the language's own pack folder. English's
// live in ZoneLoreAudio -- its high tier -- and package-audio.sh transcodes down
// from there.
export function soundsDir(lang = LANG) {
  const override = process.env.ZONELORE_SOUNDS;
  if (override) {
    return lang === BASE_LOCALE ? override : join(dirname(override), packFolder(lang, "high"));
  }
  return join(ROOT, "addons", packFolder(lang, "high"), "Sounds");
}

export const SAMPLES_DIR = join(ROOT, "pipelines/zones/audio-samples");

// A sibling of Sounds/, never a subdirectory: validate-audio.mjs walks Sounds/ and
// would report every archived take as an mp3 with no manifest entry. The same
// reasoning is written down at ../wow-voiceover/web/src/lib/paths.ts:53.
//
// This is the one directory whose loss is permanent: version 1 of each file is the
// take the corpus was originally cut with, and restoring it is the undo for a re-roll
// that came out worse.
// Superseded takes. English keeps the flat audio-history/{file}/v{n}.mp3 layout it
// already has on disk and on the droplet; another language nests under its code,
// which cannot collide with the numeric mapID directories beneath it. Without that
// split two languages would share one version sequence for the same file, and a
// restore would install whichever clip happened to be v2.
export function historyDir(lang = LANG) {
  const base = process.env.ZONELORE_AUDIO_HISTORY || join(ROOT, "pipelines/zones/audio-history");
  return lang === BASE_LOCALE ? base : join(base, lang);
}

// The fields that make up a manifest record, in the order the JSON file writes them,
// so an exported manifest diffs cleanly against the hand-written one it replaces.
const TAKE_COLUMNS = [
  "file",
  "textHash",
  "chars",
  "credits",
  "durationSec",
  "bytes",
  "voiceId",
  "modelId",
  "outputFormat",
  "dictionaryId",
  "dictionaryVersionId",
];

//------------------------------------------------------------------------------
// Reading
//------------------------------------------------------------------------------

// What loadManifest last returned, so saveManifest can tell which entries are new
// takes rather than re-inserting all 1353 rows every time it is called -- and
// generate.mjs calls it after every single line.
// Per language: the explorer can hold two manifests at once, and a shared baseline
// would make every entry of the language not loaded last look like a new take.
const baselines = new Map();

function recordKey(record) {
  // generatedAt alone identifies a take: it is stamped fresh on every synthesis, and
  // two takes of one line cannot share it.
  return record?.generatedAt ?? null;
}

function rebase(manifest, lang) {
  baselines.set(lang, new Map(Object.entries(manifest).map(([id, r]) => [id, recordKey(r)])));
}

export async function loadManifest(lang = LANG) {
  const manifest = db.isEnabled() ? await loadFromDatabase(lang) : await loadFromFile(lang);
  rebase(manifest, lang);
  return manifest;
}

async function loadFromFile(lang) {
  try {
    return JSON.parse(await readFile(manifestPath(lang), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function loadFromDatabase(lang) {
  const { rows } = await db.query(
    `select "lineId", ${TAKE_COLUMNS.map((c) => `"${c}"`).join(", ")}, "generatedAt"
       from "voiceline_take"
      where "isCurrent" and "lang" = $1`,
    [lang],
  );

  const manifest = {};
  for (const row of rows) {
    const record = {};
    for (const column of TAKE_COLUMNS) record[column] = row[column];
    // The JSON file stores an ISO string; the driver hands back a Date. The exported
    // manifest has to match the file it replaces, so normalise here rather than in the
    // exporter -- that way every reader sees one shape.
    record.generatedAt = row.generatedAt.toISOString();
    manifest[row.lineId] = record;
  }
  return manifest;
}

//------------------------------------------------------------------------------
// Writing
//------------------------------------------------------------------------------

// Serialised, because every worker saves after every line it finishes. Two concurrent
// writers on one JSON path interleave into invalid JSON, and in database mode two
// concurrent version computations would race for the same version number. The chain is
// only ever extended, so a failed save cannot stall the ones behind it.
let saveChain = Promise.resolve();

export function saveManifest(manifest, lang = LANG) {
  const mine = saveChain.then(
    () => persist(manifest, lang),
    () => persist(manifest, lang),
  );
  saveChain = mine.catch(() => {});
  return mine;
}

async function persist(manifest, lang) {
  if (db.isEnabled()) {
    await saveToDatabase(manifest, lang);
  } else {
    await writeManifestFile(manifest, lang);
  }
  rebase(manifest, lang);
}

// Sorted, so a run that adds one line produces a one-line diff rather than a
// reshuffled file. Written beside the target and renamed: a crash partway through a
// write would otherwise destroy the record of everything already paid for, which is
// the one file here that cannot be regenerated.
async function writeManifestFile(manifest, lang) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  const path = manifestPath(lang);
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, JSON.stringify(ordered, null, 2) + "\n");
  await rename(temp, path);
}

// Only entries that changed since the last load or save become takes. Everything else
// in the object is what loadManifest already returned, and is already a row.
async function saveToDatabase(manifest, lang) {
  const baseline = baselines.get(lang) ?? new Map();
  for (const [lineId, record] of Object.entries(manifest)) {
    if (baseline.get(lineId) === recordKey(record)) continue;
    await insertTake(lineId, record, "generated", null, lang);
  }
}

// One transaction: retiring the live take and inserting its replacement must not half
// apply, or the partial unique index would refuse every later write for this line and
// the failure would look like a bug in the next run rather than this one.
export async function insertTake(lineId, record, origin, settings = null, lang = LANG) {
  return db.transaction(async (client) => {
    await client.query(
      `update "voiceline_take" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [lineId, lang],
    );

    // The version comes from a select over this line's own rows rather than from the
    // caller, so nothing outside this transaction has to know or guess it.
    const { rows } = await client.query(
      `insert into "voiceline_take" (
         "lineId", "lang", "version", "isCurrent", "origin", "settings",
         ${TAKE_COLUMNS.map((c) => `"${c}"`).join(", ")}, "generatedAt"
       )
       select $1, $2,
              coalesce(max("version"), 0) + 1,
              true, $3, $4::jsonb,
              ${TAKE_COLUMNS.map((_, i) => `$${i + 5}`).join(", ")},
              $${TAKE_COLUMNS.length + 5}::timestamptz
         from "voiceline_take" where "lineId" = $1 and "lang" = $2
       returning "version"`,
      [
        lineId,
        lang,
        origin,
        settings === null ? null : JSON.stringify(settings),
        ...TAKE_COLUMNS.map((column) => record[column] ?? null),
        record.generatedAt,
      ],
    );

    return rows[0].version;
  });
}

//------------------------------------------------------------------------------
// Audio
//------------------------------------------------------------------------------

// Writes a clip, archiving whatever it replaces.
//
// This lives here rather than in generate.mjs because the archive has exactly one
// correct moment: after the replacement exists in memory, and before it lands on the
// path the old take occupies. generate.mjs writes the mp3 and *then* records the take,
// so an archive step driven by the record would always run one instant too late, with
// the file it wanted to keep already overwritten.
//
// `file` is store-relative and extension-less, e.g. "1411/razor-hill" -- the same
// string the manifest, the lookup table and voiceline_take all carry. Returns the
// absolute path written, which the caller needs for ffprobe and stat.
export async function writeAudio(file, buffer, lang = LANG) {
  const path = join(soundsDir(lang), `${file}.mp3`);

  await archiveExisting(file, path, lang);

  await mkdir(dirname(path), { recursive: true });
  // Write beside the target and rename, so an interrupted run cannot leave a truncated
  // mp3 that later looks like a finished one.
  const temp = `${path}.part`;
  await writeFile(temp, buffer);
  await rename(temp, path);

  return path;
}

// Retires a live clip without writing a replacement: the mp3 moves to
// audio-history/{file}/v{n}.mp3 and the caller flips the take off in the
// database. The undo is restoreTake, exactly as for a re-roll. Returns whether
// there was a file to move.
export async function archiveAudio(file, lang = LANG) {
  const path = join(soundsDir(lang), `${file}.mp3`);
  if (!existsSync(path)) return false;
  await archiveExisting(file, path, lang);
  return true;
}

// Moves the live clip to audio-history/{file}/v{n}.mp3. A rename, not a copy: the bytes
// are about to be replaced either way, and copying 300MB during a bulk re-cut is pure
// IO for no additional safety.
async function archiveExisting(file, path, lang) {
  if (!existsSync(path)) return;

  const dir = join(historyDir(lang), file);
  await mkdir(dir, { recursive: true });

  // Numbered from what is already archived rather than from voiceline_take."version".
  // The two agree in database mode, but this has to work with DATABASE_URL unset too,
  // and a filename derived from the database would make the archive unreadable without
  // it.
  const existing = await readdir(dir).catch(() => []);
  const highest = existing.reduce((max, name) => {
    const match = /^v(\d+)\.mp3$/.exec(name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  await rename(path, join(dir, `v${highest + 1}.mp3`));
}

// ffprobe rather than parsing frame headers: the duration is what stops the addon's
// Play button resetting at the wrong moment, and a CBR assumption in a hand-rolled
// parser would be wrong silently.
//
// Here rather than in generate.mjs because the web app needs it for exactly the same
// reason and on the same files -- a second copy is a second thing to get wrong.
export async function durationOf(path) {
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

// Puts an archived take back. No API call and no credits -- this is the undo for a
// re-roll that came out worse, which is the whole reason takes are kept.
export async function restoreTake(file, archiveVersion, lang = LANG) {
  const archived = join(historyDir(lang), file, `v${archiveVersion}.mp3`);
  if (!existsSync(archived)) {
    throw new Error(`no archived take at ${archived}`);
  }

  const path = join(soundsDir(lang), `${file}.mp3`);
  // Archive the clip being replaced first, so a restore is itself reversible.
  await archiveExisting(file, path, lang);
  await mkdir(dirname(path), { recursive: true });
  await rename(archived, path);

  return path;
}

// Scripts are short-lived and an open pool keeps the process alive after main()
// returns, which looks exactly like a hang.
export async function close() {
  await db.close();
}
