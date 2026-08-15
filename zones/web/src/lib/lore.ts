// The lore corpus as the explorer sees it: the live text of every line, its history,
// and the one write that changes it.
//
// SERVER ONLY. catalogue.ts layers what this returns over the text read from the Lua
// files, so an edit is visible in the explorer the moment it is saved rather than after
// the next export and restart.

import "server-only";

import { query, pool } from "./db";
import { BASE_LANG, type Lang } from "./lang";
import { areaName, loadAreaNames, makeShort } from "./tools";

/** The live text of one line. */
export type LoreLine = {
  lineId: string;
  version: number;
  origin: "scraped" | "edited" | "scraped-rewritten";
  name: string;
  full: string;
  short: string;
  shortIsManual: boolean;
  source: string | null;
  editedBy: string | null;
  note: string | null;
  createdAt: string;
};

/** One entry in a line's history, as the dialog lists them. */
export type LoreVersion = LoreLine & { isCurrent: boolean };

type Row = Omit<LoreLine, "createdAt"> & { createdAt: Date; isCurrent: boolean };

function toVersion(row: Row): LoreVersion {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

const COLUMNS = `"lineId", "version", "isCurrent", "origin", "name", "full", "short",
                 "shortIsManual", "source", "editedBy", "note", "createdAt"`;

// Every query below names its language in SQL rather than assuming it. A line has one
// current version PER LANGUAGE (migration 0008), so an unscoped `where "isCurrent"`
// would not merely show the wrong language -- saving an English edit would clear the
// German row's live flag and insert its replacement as English, leaving German with no
// current text at all.

/**
 * The live version of every line, keyed by lineId.
 *
 * Returns an empty map when the table has not been seeded, which is what makes this
 * safe to layer unconditionally: before `make lore-import` runs, the explorer shows
 * exactly what the Lua files say, as it always did.
 */
export async function currentLore(lang: Lang = BASE_LANG): Promise<Map<string, LoreLine>> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "lore_line" where "isCurrent" and "lang" = $1`,
    [lang],
  );
  return new Map(rows.map((row) => [row.lineId, toVersion(row)]));
}

/** Every version of one line, newest first. */
export async function loreHistory(
  lineId: string,
  lang: Lang = BASE_LANG,
): Promise<LoreVersion[]> {
  const rows = await query<Row>(
    `select ${COLUMNS} from "lore_line"
      where "lineId" = $1 and "lang" = $2
      order by "version" desc`,
    [lineId, lang],
  );
  return rows.map(toVersion);
}

export class LoreConflict extends Error {}
export class LoreMissing extends Error {}

/**
 * Saves a rewritten line as a new live version.
 *
 * `expectedVersion` is optimistic concurrency, not ceremony: the dialog holds the text
 * it loaded, and two editors on the same line would otherwise silently overwrite each
 * other with a full paragraph rather than a field. Sending the version the edit started
 * from turns that into a 409 the second person can see.
 *
 * The structural fields are copied from the current version rather than accepted from
 * the caller. Which subzones exist and what they are keyed on is the scraper's business,
 * and an API that let a text edit move a line to another uiMapID would be one bad
 * request away from a line the addon can never look up.
 *
 * THE FIRST TRANSLATION OF A LINE HAS NOTHING TO COPY FROM. Writing German for a line
 * nobody has translated is an insert, not an edit, so the structure -- and the wiki
 * source with its licence -- comes from the English row instead. Which language a line
 * exists in is not a property of the place, and a translator should not have to seed a
 * row before writing one.
 */
export async function saveLore(args: {
  lineId: string;
  full: string;
  short?: string | null;
  note?: string | null;
  editedBy: string;
  expectedVersion?: number | null;
  /** Which language is being written. A translation is a row of its own, not an edit. */
  lang?: Lang;
}): Promise<LoreVersion> {
  const lang = args.lang ?? BASE_LANG;
  const client = await pool().connect();
  try {
    await client.query("begin");

    const { rows: currentRows } = await client.query<Row & { mapID: number; kind: string; key: string | null }>(
      `select ${COLUMNS}, "mapID", "kind", "key" from "lore_line"
        where "lineId" = $1 and "lang" = $2 and "isCurrent" for update`,
      [args.lineId, lang],
    );
    let current = currentRows[0];
    let translating = false;

    if (!current && lang !== BASE_LANG) {
      const { rows: englishRows } = await client.query<
        Row & { mapID: number; kind: string; key: string | null }
      >(
        `select ${COLUMNS}, "mapID", "kind", "key" from "lore_line"
          where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [args.lineId, BASE_LANG],
      );
      current = englishRows[0];
      translating = current !== undefined;
    }

    if (!current) {
      throw new LoreMissing(
        `${args.lineId} is not in lore_line -- seed the table with: make lore-import`,
      );
    }

    // Only meaningful against a version of the same language. A first translation has
    // none, and comparing against the English row's number would reject every save.
    if (
      !translating &&
      args.expectedVersion !== undefined &&
      args.expectedVersion !== null &&
      args.expectedVersion !== current.version
    ) {
      throw new LoreConflict(
        `this line moved to v${current.version} while you were editing it`,
      );
    }

    const full = args.full.trim();
    if (!full) throw new Error("the text cannot be empty");
    // A translated row is named as the client names the place in that language
    // (tools/lib/area-names.mjs); nobody types a place name. English keeps its own.
    // The lookup needs the English name -- a zone's key is derived from it -- and a
    // row already translated no longer carries that, so it is read from English's row.
    let name = current.name;
    if (lang !== BASE_LANG) {
      let englishName = current.name;
      if (!translating) {
        const { rows } = await client.query<{ name: string }>(
          `select "name" from "lore_line" where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
          [args.lineId, BASE_LANG],
        );
        englishName = rows[0]?.name ?? current.name;
      }
      name = areaName(await loadAreaNames(), lang, { ...current, name: englishName });
    }

    // A save that changes nothing must not spend a version number: the history is a
    // record of what the text has been, not of who opened the dialog. A translation
    // that happens to match the English is still a translation -- somebody decided the
    // name stays as it is -- so this only applies within one language.
    if (!translating && full === current.full && name === current.name && (args.short ?? null) === null) {
      await client.query("commit");
      return toVersion(current);
    }

    const shortIsManual = typeof args.short === "string" && args.short.trim() !== "";
    const short = shortIsManual ? args.short!.trim() : makeShort(full);

    const { rows: maxRows } = await client.query<{ version: string }>(
      `select coalesce(max("version"), 0) as "version"
         from "lore_line" where "lineId" = $1 and "lang" = $2`,
      [args.lineId, lang],
    );
    const version = Number(maxRows[0].version) + 1;

    await client.query(
      `update "lore_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [args.lineId, lang],
    );

    const { rows: inserted } = await client.query<Row>(
      `insert into "lore_line"
         ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key",
          "name", "full", "short", "shortIsManual", "source", "editedBy", "note")
       values ($1, $2, $3, true, 'edited', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning ${COLUMNS}`,
      [
        args.lineId,
        lang,
        version,
        current.mapID,
        current.kind,
        current.key,
        name,
        full,
        short,
        shortIsManual,
        // The source rides along unchanged. An edit of wiki text is a derivative of it,
        // so the attribution and the CC BY-SA licence follow the edit; only prose with
        // no wiki ancestor has no source, and that is decided when the row is created.
        current.source,
        args.editedBy,
        args.note?.trim() || null,
      ],
    );

    await client.query("commit");
    return toVersion(inserted[0]);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Puts an earlier version back.
 *
 * Moves the live flag rather than inserting a copy, which is what `restore` means for a
 * take too: the history is the set of texts this line has had, and restoring is a
 * statement about which of them is right, not a new one.
 */
export async function restoreLore(
  lineId: string,
  version: number,
  lang: Lang = BASE_LANG,
): Promise<LoreVersion> {
  const client = await pool().connect();
  try {
    await client.query("begin");

    const { rows } = await client.query<Row>(
      `select ${COLUMNS} from "lore_line"
        where "lineId" = $1 and "lang" = $2 and "version" = $3 for update`,
      [lineId, lang, version],
    );
    if (!rows[0]) throw new LoreMissing(`${lineId} has no version ${version}`);

    await client.query(
      `update "lore_line" set "isCurrent" = false
        where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
      [lineId, lang],
    );
    const { rows: restored } = await client.query<Row>(
      `update "lore_line" set "isCurrent" = true
        where "lineId" = $1 and "lang" = $2 and "version" = $3
        returning ${COLUMNS}`,
      [lineId, lang, version],
    );

    await client.query("commit");
    return toVersion(restored[0]);
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
