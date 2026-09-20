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
//   DATABASE_URL set    -> the "take" table, with a row per take and a history
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

import { BASE_LOCALE, packFolder } from "../lib/locales.mjs";
import { ROOT } from "../lib/loredata.mjs";
import * as db from "./db.mjs";

const execFileAsync = promisify(execFile);

// The lore is English and nothing here takes a language. The "lang" column stays on
// the shared "take" table -- quests and books write it too, and a column is never
// dropped here -- so every row this module writes names the one value there is.
export const LANG = BASE_LOCALE;

// Each of these can be overridden by an environment variable, and on the droplet each
// one is: SPOKEN_ZONES_ROOT points at the current release, and these three point *outside*
// it. What they have in common is that the app writes them, so leaving them inside a
// release would mean prune.sh deleting them five deploys later. See deploy/README.md.
// Unset, which is every local run, they are exactly the repo paths they always were.
//
// The environment overrides are what the droplet sets: they point outside the release
// directory so a deploy cannot move ~700 MB and prune.sh cannot delete it. Unset, which
// is every local run, these are exactly the repo paths they always were.

export function manifestPath() {
  return process.env.SPOKEN_ZONES_MANIFEST
    || join(ROOT, "pipelines/zones/tools/voice/manifest.json");
}

// The masters, at full bitrate, inside the pack's high tier. package-audio.sh
// transcodes down from there.
export function soundsDir() {
  return process.env.SPOKEN_ZONES_SOUNDS
    || join(ROOT, "addons", packFolder(BASE_LOCALE, "high"), "Sounds");
}

// A sibling of Sounds/, never a subdirectory: validate-audio.mjs walks Sounds/ and
// would report every archived take as an mp3 with no manifest entry. The same
// reasoning is written down at ../wow-voiceover/web/src/lib/paths.ts:53.
//
// This is the one directory whose loss is permanent: version 1 of each file is the
// take the corpus was originally cut with, and restoring it is the undo for a re-roll
// that came out worse.
// Superseded takes, in the flat audio-history/{file}/v{n}.mp3 layout the droplet
// already has on disk.
export function historyDir() {
  return process.env.SPOKEN_ZONES_AUDIO_HISTORY
    || join(ROOT, "pipelines/zones/audio-history");
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

// Written to the row but NOT to the manifest: the lead-in is how a take was made, not what
// the addon needs to play it, and adding fields to TAKE_COLUMNS would restate every entry
// in the committed manifest.json. See apps/web/src/lib/generation/leadin.ts.
const LEAD_IN_COLUMNS = { leadIn: false, leadInSec: null };
const INSERT_COLUMNS = [...TAKE_COLUMNS, ...Object.keys(LEAD_IN_COLUMNS)];

// This project's own source in the shared table. Both sites' takes live in one "take"
// table now, and the two name files by different frozen rules -- quests files carry an
// extension and are shared by several NPCs, these are extension-less and one per line --
// so nothing here may read or write a row without saying which corpus it belongs to.
const SOURCE = "zones";

// Manifest field -> column, for the four the merge renamed. The manifest keys do NOT
// change: manifest.json is committed, build-lookup.mjs and package-audio.sh read it, and
// `make import && make export` must still leave it byte-identical. So the record shape is
// the file's, and the column names are the table's, and this is where the two meet.
const COLUMN_OF = {
  textHash: "spokenHash",
  chars: "characters",
  dictionaryVersionId: "dictionaryVersion",
  generatedAt: "createdAt",
};

const columnOf = (field) => COLUMN_OF[field] ?? field;

// `"spokenHash" as "textHash"`, so a row comes back shaped like a manifest record and
// every reader below stays written in the manifest's terms.
const selectAs = (field) =>
  COLUMN_OF[field] ? `"${COLUMN_OF[field]}" as "${field}"` : `"${field}"`;

//------------------------------------------------------------------------------
// Reading
//------------------------------------------------------------------------------

// What loadManifest last returned, so saveManifest can tell which entries are new
// takes rather than re-inserting all 1353 rows every time it is called -- and
// generate.mjs calls it after every single line.
let baseline = new Map();

function recordKey(record) {
  // generatedAt alone identifies a take: it is stamped fresh on every synthesis, and
  // two takes of one line cannot share it.
  return record?.generatedAt ?? null;
}

function rebase(manifest) {
  baseline = new Map(Object.entries(manifest).map(([id, r]) => [id, recordKey(r)]));
}

export async function loadManifest() {
  const manifest = db.isEnabled() ? await loadFromDatabase() : await loadFromFile();
  rebase(manifest);
  return manifest;
}

async function loadFromFile() {
  try {
    return JSON.parse(await readFile(manifestPath(), "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function loadFromDatabase() {
  const { rows } = await db.query(
    `select "lineId", ${TAKE_COLUMNS.map(selectAs).join(", ")}, ${selectAs("generatedAt")}
       from "take"
      where "source" = '${SOURCE}' and "isCurrent" and "lang" = '${LANG}'`,
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

/**
 * Which pronunciation dictionary, and which version of it, the site is generating
 * against right now.
 *
 * Read from the lexicon row rather than from ElevenLabs, for the same reason the
 * manifest is read from the "take" table: the database is what the generation path
 * acts on, so it is the honest answer to "what would a line be cut with today".
 * Asking the API would also mean this module needed a credential, and the commands
 * that call it are the ones deliberately without one.
 *
 * Null when there is no database, or when the lexicon has never synced -- a row that
 * Postgres has and ElevenLabs does not is a legitimate state, and "unknown" is not
 * "changed". Callers decide what to do about it; comparing against null would mark
 * all 1353 lines as drifted, which is the opposite of useful.
 */
export async function currentDictionary() {
  if (!db.isEnabled()) return null;
  const { rows } = await db.query(
    `select "dictionaryId", "versionId" from "pronunciation_lexicon" where "id"`,
  );
  const row = rows[0];
  if (!row?.dictionaryId || !row.versionId) return null;
  return { dictionaryId: row.dictionaryId, versionId: row.versionId };
}

//------------------------------------------------------------------------------
// Writing
//------------------------------------------------------------------------------

// Serialised, because every worker saves after every line it finishes. Two concurrent
// writers on one JSON path interleave into invalid JSON, and in database mode two
// concurrent version computations would race for the same version number. The chain is
// only ever extended, so a failed save cannot stall the ones behind it.
let saveChain = Promise.resolve();

export function saveManifest(manifest) {
  const mine = saveChain.then(
    () => persist(manifest),
    () => persist(manifest),
  );
  saveChain = mine.catch(() => {});
  return mine;
}

async function persist(manifest) {
  if (db.isEnabled()) {
    await saveToDatabase(manifest);
  } else {
    await writeManifestFile(manifest);
  }
  rebase(manifest);
}

// Sorted, so a run that adds one line produces a one-line diff rather than a
// reshuffled file. Written beside the target and renamed: a crash partway through a
// write would otherwise destroy the record of everything already paid for, which is
// the one file here that cannot be regenerated.
async function writeManifestFile(manifest) {
  const ordered = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  );
  const path = manifestPath();
  const temp = `${path}.${process.pid}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temp, JSON.stringify(ordered, null, 2) + "\n");
  await rename(temp, path);
}

// Only entries that changed since the last load or save become takes. Everything else
// in the object is what loadManifest already returned, and is already a row.
async function saveToDatabase(manifest) {
  for (const [lineId, record] of Object.entries(manifest)) {
    if (baseline.get(lineId) === recordKey(record)) continue;
    await insertTake(lineId, record, "generated");
  }
}

// One transaction: retiring the live take and inserting its replacement must not half
// apply, or the partial unique index would refuse every later write for this line and
// the failure would look like a bug in the next run rather than this one.
export async function insertTake(lineId, record, origin, settings = null) {
  // Retired and numbered BY FILE rather than by line, which is what the shared table's
  // partial unique index is on. For this project the two are the same key -- naming.mjs
  // gives every line a file of its own and disambiguates a slug collision by hash -- so
  // this is the same set of rows under the name the index knows it by. Clearing by line
  // and inserting by file is how a second live take would slip past.
  const file = record.file;

  return db.transaction(async (client) => {
    await client.query(
      `update "take" set "isCurrent" = false
        where "source" = '${SOURCE}' and "file" = $1 and "lang" = '${LANG}' and "isCurrent"`,
      [file],
    );

    // The version comes from a select over this file's own rows rather than from the
    // caller, so nothing outside this transaction has to know or guess it.
    const { rows } = await client.query(
      `insert into "take" (
         "source", "lineId", "lang", "version", "isCurrent", "origin", "settings",
         ${INSERT_COLUMNS.map((c) => `"${columnOf(c)}"`).join(", ")}, "createdAt"
       )
       select '${SOURCE}', $1, $2,
              coalesce(max("version"), 0) + 1,
              true, $3, $4::jsonb,
              ${INSERT_COLUMNS.map((_, i) => `$${i + 6}`).join(", ")},
              $${INSERT_COLUMNS.length + 6}::timestamptz
         from "take"
        where "source" = '${SOURCE}' and "file" = $5 and "lang" = $2
       returning "version"`,
      [
        lineId,
        LANG,
        origin,
        settings === null ? null : JSON.stringify(settings),
        file,
        // `?? LEAD_IN_COLUMNS[column]` rather than `?? null` for the last two: "leadIn" is
        // NOT NULL, and a CLI caller that knows nothing about lead-ins says false by omission.
        ...INSERT_COLUMNS.map((column) => record[column] ?? LEAD_IN_COLUMNS[column] ?? null),
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
// string the manifest, the lookup table and the take table all carry. Returns the
// absolute path written, which the caller needs for ffprobe and stat.
export async function writeAudio(file, buffer) {
  const path = join(soundsDir(), `${file}.mp3`);

  await archiveExisting(file, path);

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
export async function archiveAudio(file) {
  const path = join(soundsDir(), `${file}.mp3`);
  if (!existsSync(path)) return false;
  await archiveExisting(file, path);
  return true;
}

// Moves the live clip to audio-history/{file}/v{n}.mp3. A rename, not a copy: the bytes
// are about to be replaced either way, and copying 300MB during a bulk re-cut is pure
// IO for no additional safety.
async function archiveExisting(file, path) {
  if (!existsSync(path)) return;

  const dir = join(historyDir(), file);
  await mkdir(dir, { recursive: true });

  // Numbered from what is already archived rather than from take."version".
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
export async function restoreTake(file, archiveVersion) {
  const archived = join(historyDir(), file, `v${archiveVersion}.mp3`);
  if (!existsSync(archived)) {
    throw new Error(`no archived take at ${archived}`);
  }

  const path = join(soundsDir(), `${file}.mp3`);
  // Archive the clip being replaced first, so a restore is itself reversible.
  await archiveExisting(file, path);
  await mkdir(dirname(path), { recursive: true });
  await rename(archived, path);

  return path;
}

// Scripts are short-lived and an open pool keeps the process alive after main()
// returns, which looks exactly like a hang.
export async function close() {
  await db.close();
}
