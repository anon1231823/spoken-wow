/**
 * The lexicon in force, and the ElevenLabs dictionary it corresponds to.
 *
 * The sibling of settings.ts, and the same two layers for the same reason: voice/lexicon.json
 * ships in the release and is what tools/build_lexicon.py generates from, the
 * pronunciation_lexicon row - when it exists - is what the web app generates with, and reading
 * reports which of the two is in force so "why does this sound different from what the CLI
 * made" stays answerable.
 *
 * One thing here has no equivalent in settings.ts: a saved lexicon is inert until it has been
 * uploaded. Saving therefore does two things that can fail independently, so the row records
 * both the entries and the locator they produced, and readLexicon reports a save that reached
 * Postgres but not ElevenLabs as exactly that rather than as success.
 */
import { db } from "@/lib/db";
import {
  createPronunciationDictionary,
  type DictionaryLocator,
  type ElevenLabsOptions,
} from "@/lib/voices/elevenlabs";

import { fileDefaults } from "./files";
import { toRules, type LexiconEntry } from "./lexicon";

export type LexiconSync = "synced" | "pending" | "never";

export type EffectiveLexicon = {
  entries: LexiconEntry[];
  /** Whether the row exists, i.e. whether anyone has overridden the committed file. */
  source: "file" | "database";
  /** The committed entries, so the editor can offer "reset" and show the delta. */
  defaults: LexiconEntry[];
  /**
   * Whether the entries above are the ones ElevenLabs is holding.
   *
   * `never` means nothing has been uploaded and generation applies no dictionary at all.
   * `pending` means a save was stored but its upload failed, so generation is still applying
   * the PREVIOUS locator - the editor has to say so, because the page would otherwise show
   * entries that are not the ones in effect.
   */
  sync: LexiconSync;
  locator: DictionaryLocator | null;
  syncedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Row = {
  entries: LexiconEntry[];
  dictionaryId: string | null;
  versionId: string | null;
  syncedAt: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

function older(a: string, b: string): boolean {
  return new Date(a).getTime() < new Date(b).getTime();
}

async function readRow(): Promise<Row | undefined> {
  const { rows } = await db().query<Row>(
    `select "entries", "dictionaryId", "versionId", "syncedAt", "updatedAt", "updatedBy"
       from "pronunciation_lexicon" where "id"`,
  );
  return rows[0];
}

export async function readLexicon(): Promise<EffectiveLexicon> {
  const defaults = fileDefaults().lexicon;
  const row = await readRow();

  if (!row) {
    // The committed file is in force as a document, but nothing has been uploaded, so no
    // dictionary is applied to a request. Saying "file" and "never" together is the honest
    // description of a fresh install: these are the intended pronunciations, and none of
    // them are reaching ElevenLabs yet.
    return {
      entries: defaults,
      source: "file",
      defaults,
      sync: "never",
      locator: null,
      syncedAt: null,
      updatedAt: null,
      updatedBy: null,
    };
  }

  const locator =
    row.dictionaryId && row.versionId
      ? { dictionaryId: row.dictionaryId, versionId: row.versionId }
      : null;

  return {
    entries: row.entries,
    source: "database",
    defaults,
    // syncedAt is stamped in the same statement as the locator, so an upload that predates
    // the current entries is exactly the case where syncedAt is older than updatedAt.
    // Compared as instants rather than as values: pg hands timestamptz back as a Date, but
    // these are declared as strings and cross the wire as ISO, so both forms reach here.
    sync: !locator || !row.syncedAt || older(row.syncedAt, row.updatedAt) ? "pending" : "synced",
    locator,
    syncedAt: row.syncedAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/**
 * The locator to attach to a TTS request, or null to send none.
 *
 * Null rather than a throw when nothing has been uploaded: a missing dictionary costs
 * pronunciation quality, and refusing to generate over it would take regeneration down for
 * everyone the first time an upload failed.
 */
export async function currentLocator(): Promise<DictionaryLocator | null> {
  const row = await readRow();
  if (!row?.dictionaryId || !row.versionId) return null;
  return { dictionaryId: row.dictionaryId, versionId: row.versionId };
}

/**
 * Store the entries, then try to upload them.
 *
 * In that order, and not in a transaction spanning the upload. A save that survives a failed
 * upload can be retried from the editor; an upload that survives a failed save would leave
 * ElevenLabs holding rules that no row describes, and generation would apply pronunciations
 * that nothing in this app can show anyone.
 */
export async function writeLexicon(
  entries: LexiconEntry[],
  updatedBy: string,
  options: ElevenLabsOptions = {},
): Promise<{ lexicon: EffectiveLexicon; syncError: string | null }> {
  await db().query(
    `insert into "pronunciation_lexicon" ("id", "entries", "updatedAt", "updatedBy")
     values (true, $1, now(), $2)
     on conflict ("id") do update set
       "entries"   = excluded."entries",
       "updatedAt" = excluded."updatedAt",
       "updatedBy" = excluded."updatedBy"`,
    [JSON.stringify(entries), updatedBy],
  );

  const syncError = await sync(entries, options);
  return { lexicon: await readLexicon(), syncError };
}

/**
 * Upload the entries and record where they landed. Returns null, or why it failed.
 *
 * The failure is returned rather than thrown because it is not the save failing: the entries
 * are already stored, the editor still has something true to show, and the only thing lost is
 * that the change is not yet in effect. A thrown error here would read to the caller as "your
 * edit was rejected", which would be wrong.
 */
export async function sync(
  entries: LexiconEntry[],
  options: ElevenLabsOptions = {},
): Promise<string | null> {
  let locator: DictionaryLocator;
  try {
    // Dated, because a new dictionary is created per save and the account list would
    // otherwise be a column of identical names with no way to tell which is live.
    const name = `wow-voiceover ${new Date().toISOString().slice(0, 19).replace("T", " ")}`;
    locator = await createPronunciationDictionary(name, toRules(entries), options);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  // Conditional on the entries still being the ones that were uploaded. Two admins saving at
  // once would otherwise interleave as save(A), save(B), upload(A), upload(B) - and after
  // upload(A) landed last, the row would pair B's entries with A's rules and, because
  // syncedAt is then newer than updatedAt, report itself as synced. The editor would be
  // showing entries that nothing is being spoken with, which is the one lie this module is
  // built to avoid. jsonb equality ignores key order, so this compares content, not spelling.
  const { rowCount } = await db().query(
    `update "pronunciation_lexicon"
        set "dictionaryId" = $1, "versionId" = $2, "syncedAt" = now()
      where "id" and "entries" = $3::jsonb`,
    [locator.dictionaryId, locator.versionId, JSON.stringify(entries)],
  );
  if (rowCount === 0) {
    return "the lexicon changed while this upload was in flight; the newer save is the one to retry";
  }
  return null;
}

/** Re-upload whatever is stored, for retrying a sync that failed after a successful save. */
export async function resync(options: ElevenLabsOptions = {}): Promise<string | null> {
  const row = await readRow();
  if (!row) return "there is no saved lexicon to upload";
  return sync(row.entries, options);
}

/**
 * Drop the override, so the committed file is in force again.
 *
 * The locator goes with the row, which means generation stops applying any dictionary at
 * all. That is the correct reading of "reset": the committed file has never been uploaded
 * by anyone, so leaving the last upload attached would apply rules that no longer match
 * what the editor shows.
 */
export async function resetLexicon(): Promise<void> {
  await db().query(`delete from "pronunciation_lexicon" where "id"`);
}
