/**
 * The lexicon in force, and the ElevenLabs dictionary it corresponds to.
 *
 * Unlike settings.ts, there is one layer and not two. The row IS the lexicon. It is seeded
 * once by migration 0008 and edited from the web UI thereafter, because that is how a
 * pronunciation actually gets fixed - someone hears a name come out wrong and corrects it.
 * A file shipping inside the release could only ever be a stale snapshot competing with
 * that, which is why voice/lexicon.json is now provenance and generator input rather than
 * something this module reads.
 *
 * What has no equivalent in settings.ts either way: a saved lexicon is inert until it has
 * been uploaded. Saving does two things that can fail independently, so the row records both
 * the entries and the locator they produced, and readLexicon reports a save that reached
 * Postgres but not ElevenLabs as exactly that rather than as success.
 */
import { db } from "@/lib/db";
import {
  createPronunciationDictionary,
  type DictionaryLocator,
  type ElevenLabsOptions,
} from "@/lib/voices/elevenlabs";

import { toRules, type LexiconEntry } from "./lexicon";

export type LexiconSync = "synced" | "pending" | "never";

export type EffectiveLexicon = {
  entries: LexiconEntry[];
  /**
   * False when the table has no row at all.
   *
   * Only reachable if migration 0008 has not run, and worth reporting rather than rendering
   * as an empty lexicon: an editor with no rows is exactly what a failed deploy looked like
   * before, and it should say so instead of inviting someone to retype 134 entries.
   */
  seeded: boolean;
  /**
   * Whether the entries above are the ones ElevenLabs is holding.
   *
   * `never` means no dictionary has ever been uploaded, so generation applies none at all.
   * That is the state a freshly seeded row is in, and it is not the same as `pending`.
   * `pending` means a save was stored but its upload failed, so generation is still applying
   * the PREVIOUS locator - the editor has to say so, because the page would otherwise show
   * entries that are not the ones in effect. Collapsing the two would tell someone their
   * edit is queued behind an older dictionary when in fact nothing is being applied.
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
  const row = await readRow();

  if (!row) {
    return {
      entries: [],
      seeded: false,
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
    seeded: true,
    // No locator at all is `never`, not `pending`: nothing is in force, so there is no older
    // dictionary for this save to be queued behind. Beyond that, syncedAt is stamped in the
    // same statement as the locator, so an upload that predates the current entries is
    // exactly the case where syncedAt is older than updatedAt. Compared as instants rather
    // than as values: pg hands timestamptz back as a Date, but these are declared as strings
    // and cross the wire as ISO, so both forms reach here.
    sync: !locator
      ? "never"
      : !row.syncedAt || older(row.syncedAt, row.updatedAt)
        ? "pending"
        : "synced",
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
