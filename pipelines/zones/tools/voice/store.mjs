// Where audio and its record live, and how that record is read and written.
//
// READ-ONLY. generate.mjs, build-lookup.mjs and validate-audio.mjs read the take record
// through loadManifest here; nothing in this pipeline writes a take. Takes are cut by the
// site, through lib/takes/commit.ts, which every section shares -- this module used to
// hold the zones copy of that, and the web app borrowed it.
//
// TWO SOURCES, ONE SHAPE:
//
//   DATABASE_URL set    -> the "take" table, the record itself
//   DATABASE_URL unset  -> tools/voice/manifest.json, an export of that table
//
// The file is an export, not a second record: export-manifest.mjs writes it from the
// database, and it is committed so that the addon can be built and reviewed without one.

import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { BASE_LOCALE, packFolder } from "../lib/locales.mjs";
import { ROOT } from "../lib/loredata.mjs";
import * as db from "./db.mjs";

const execFileAsync = promisify(execFile);

// The lore is English and nothing here takes a language. The "lang" column stays on
// the shared "take" table -- quests and books write it too, and a column is never
// dropped here -- so every row this module reads names the one value there is.
export const LANG = BASE_LOCALE;

// Two of these can be overridden by an environment variable, and on the droplet both are:
// they point outside the release directory, so a deploy cannot move them and prune.sh
// cannot delete them. Unset, which is every local run, they are the repo paths.

export function manifestPath() {
  return process.env.SPOKEN_ZONES_MANIFEST
    || join(ROOT, "pipelines/zones/tools/voice/manifest.json");
}

// The pack's Sounds/, inside its high tier: assembled from the live takes and the archive
// by scripts/audio/sounds.mjs before a build, and read by build-lookup, validate-audio and
// package-audio.sh. Not kept anywhere -- the archive is the only audio there is.
export function soundsDir() {
  return join(ROOT, "addons", packFolder(BASE_LOCALE, "high"), "Sounds");
}

// Every take, one directory per file, each written once by the site and never changed.
//
// This is the one directory whose loss is permanent.
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


// `"spokenHash" as "textHash"`, so a row comes back shaped like a manifest record and
// every reader below stays written in the manifest's terms.
const selectAs = (field) =>
  COLUMN_OF[field] ? `"${COLUMN_OF[field]}" as "${field}"` : `"${field}"`;

//------------------------------------------------------------------------------
// Reading
//------------------------------------------------------------------------------

export async function loadManifest() {
  return db.isEnabled() ? await loadFromDatabase() : await loadFromFile();
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
// Audio
//------------------------------------------------------------------------------

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

// Scripts are short-lived and an open pool keeps the process alive after main()
// returns, which looks exactly like a hang.
export async function close() {
  await db.close();
}
