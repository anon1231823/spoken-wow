// The lore corpus, read and written.
//
// This is to lore_line what tools/voice/store.mjs is to the take table: the one seam
// that decides between Postgres and the files. Nothing else in tools/ talks to the
// lore table directly.
//
// recordScrape and recordRewrite are English-only, and say so in SQL rather than by
// assumption: a scrape reads the English wiki and a rewrite rewrites English prose,
// so both are scoped to lang = 'enUS'. Unscoped, the first translated row would look
// to them like the current version of the line and get versioned over.
// recordTranslations is the one writer for every other language.
//
// WITHOUT DATABASE_URL everything here still works, reading and writing
// addon/ZoneLore/Data/*.lua as the scrapers always did. That is not a courtesy: the
// addon build, validate.mjs and package-audio.sh all run on clones with no Postgres,
// and a corpus that could only be assembled by a database would take the whole release
// path with it.

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { BASE_LOCALE } from "../lib/locales.mjs";
import { zonesLua, subzonesLua, readZones, readSubzones } from "../lib/loredata.mjs";
import { makeShort } from "../lib/wiki.mjs";
import { areaName, loadAreaNames } from "../lib/area-names.mjs";
import { isEnabled, query, transaction } from "../voice/db.mjs";
import { emitZones, emitSubzones } from "./lua.mjs";

export { isEnabled };

/** 'z:1411' | 's:1411:razor hill'. Mirrors lineId() in tools/voice/naming.mjs. */
export function lineIdFor(entry) {
  return entry.kind === "zone" ? `z:${entry.mapID}` : `s:${entry.mapID}:${entry.key}`;
}

/** Every line as the Lua files have it. The no-database path, and the import's seed. */
export async function readLinesFromLua(lang = BASE_LOCALE) {
  const [zones, subzones] = await Promise.all([readZones(lang), readSubzones(lang)]);
  return [
    ...zones.map((z) => ({ ...z, key: null, kind: "zone" })),
    ...subzones.map((s) => ({ ...s, kind: "subzone" })),
  ];
}

/**
 * The live version of every line in one language, from the database.
 *
 * Always filtered, never "whatever is current": a line has one current row per
 * language, so an unfiltered read would mix languages into a single export the
 * moment a translated row exists.
 */
export async function readCurrent(lang = BASE_LOCALE) {
  const { rows } = await query(
    `select "lineId", "lang", "version", "origin", "mapID", "kind", "key", "name", "full",
            "short", "shortIsManual", "source", "editedBy", "note", "createdAt"
       from "lore_line"
      where "isCurrent" and "lang" = $1`,
    [lang],
  );
  return rows;
}

/** Every version of one line, newest first. The history panel's query. */
export async function readHistory(lineId) {
  const { rows } = await query(
    `select "id", "version", "isCurrent", "origin", "name", "full", "short",
            "shortIsManual", "source", "editedBy", "note", "createdAt"
       from "lore_line"
      where "lineId" = $1
      order by "version" desc`,
    [lineId],
  );
  return rows;
}

// An entry with no text is not a diagnosable failure later on: it ships an addon that
// is simply silent in that subzone, which is the failure this project is least able to
// notice by itself.
function assertComplete(entries) {
  for (const e of entries) {
    if (!e.full) throw new Error(`refusing to write: ${lineIdFor(e)} has no text`);
  }
}

export async function writeZonesLua(zones, lang = BASE_LOCALE) {
  if (zones.length === 0) throw new Error("refusing to write Zones.lua: no entries");
  assertComplete(zones);
  const path = zonesLua(lang);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, emitZones(zones, lang));
  return zones.length;
}

export async function writeSubzonesLua(subzones, zoneNames, lang = BASE_LOCALE) {
  if (subzones.length === 0) throw new Error("refusing to write Subzones.lua: no entries");
  assertComplete(subzones);
  const path = subzonesLua(lang);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, emitSubzones(subzones, zoneNames, lang));
  return subzones.length;
}

/** Both data files for one language, from one corpus. The export's only writer. */
export async function writeCorpus(entries, lang = BASE_LOCALE) {
  const zones = entries.filter((e) => e.kind === "zone");
  const subzones = entries.filter((e) => e.kind === "subzone");
  const zoneNames = new Map(zones.map((z) => [z.mapID, z.name]));

  return {
    zones: await writeZonesLua(zones, lang),
    subzones: await writeSubzonesLua(subzones, zoneNames, lang),
  };
}

/**
 * Records what a scrape found.
 *
 * NEVER PROMOTES OVER AN EDIT. A scraped version is always recorded, so it can be
 * compared against later, but it only becomes live when the current version is itself
 * scraped -- a line somebody rewrote by hand keeps that rewrite until a person decides
 * otherwise. Without this, `node tools/scrape.mjs` would be a command that silently
 * discards work, and therefore a command nobody dares run.
 *
 * Identical text is not recorded at all. Re-scraping an unchanged wiki should leave the
 * history exactly as it was, or the version numbers would count scrapes rather than
 * changes.
 */
export async function recordScrape(entries) {
  const stats = { inserted: 0, promoted: 0, unchanged: 0, heldBack: 0 };

  await transaction(async (client) => {
    for (const entry of entries) {
      const lineId = lineIdFor(entry);
      const short = entry.short ?? makeShort(entry.full);

      const { rows: currentRows } = await client.query(
        `select "version", "origin", "full", "short", "name", "source"
           from "lore_line" where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
        [lineId],
      );
      const current = currentRows[0];

      if (
        current &&
        current.full === entry.full &&
        current.name === entry.name &&
        current.source === (entry.source ?? null)
      ) {
        stats.unchanged++;
        continue;
      }

      const { rows: maxRows } = await client.query(
        `select coalesce(max("version"), 0) as "version"
           from "lore_line" where "lineId" = $1 and "lang" = 'enUS'`,
        [lineId],
      );
      const version = Number(maxRows[0].version) + 1;

      // An edited *or rewritten* current version stays live; the scrape lands
      // underneath it. See recordRewrite for why 'scraped-rewritten' is excluded.
      const live = !current || current.origin === "scraped";
      if (!live) stats.heldBack++;

      if (live && current) {
        await client.query(
          `update "lore_line" set "isCurrent" = false
           where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
          [lineId],
        );
      }

      await client.query(
        `insert into "lore_line"
           ("lineId", "version", "isCurrent", "origin", "mapID", "kind", "key",
            "name", "full", "short", "shortIsManual", "source")
         values ($1, $2, $3, 'scraped', $4, $5, $6, $7, $8, $9, false, $10)`,
        [
          lineId,
          version,
          live,
          entry.mapID,
          entry.kind,
          entry.key,
          entry.name,
          entry.full,
          short,
          entry.source ?? null,
        ],
      );

      stats.inserted++;
      if (live && current) stats.promoted++;
    }
  });

  return stats;
}

/**
 * Records what a rewrite produced.
 *
 * Same bargain as recordScrape, one step further along: a rewrite may take over a
 * line that was scraped or previously rewritten, and is held back behind a hand
 * edit. The reverse does not hold -- recordScrape promotes only over 'scraped', so
 * a later `node tools/scrape.mjs` cannot quietly undo a rewrite by re-reading the
 * wiki. That asymmetry is the whole reason 'scraped-rewritten' is a distinct origin
 * rather than more rows marked 'scraped'.
 */
export async function recordRewrite(entries) {
  const stats = { inserted: 0, promoted: 0, unchanged: 0, heldBack: 0 };

  await transaction(async (client) => {
    for (const entry of entries) {
      const lineId = lineIdFor(entry);
      const short = entry.short ?? makeShort(entry.full);

      const { rows: currentRows } = await client.query(
        `select "version", "origin", "full", "shortIsManual"
           from "lore_line" where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
        [lineId],
      );
      const current = currentRows[0];

      if (!current) {
        throw new Error(`refusing to rewrite ${lineId}: no such line -- scrape it first`);
      }
      if (current.full === entry.full) {
        stats.unchanged++;
        continue;
      }

      const { rows: maxRows } = await client.query(
        `select coalesce(max("version"), 0) as "version"
           from "lore_line" where "lineId" = $1 and "lang" = 'enUS'`,
        [lineId],
      );
      const version = Number(maxRows[0].version) + 1;

      const live = current.origin !== "edited";
      if (!live) stats.heldBack++;

      if (live) {
        await client.query(
          `update "lore_line" set "isCurrent" = false
           where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
          [lineId],
        );
      }

      await client.query(
        `insert into "lore_line"
           ("lineId", "version", "isCurrent", "origin", "mapID", "kind", "key",
            "name", "full", "short", "shortIsManual", "source", "note")
         values ($1, $2, $3, 'scraped-rewritten', $4, $5, $6, $7, $8, $9, false, $10, $11)`,
        [
          lineId,
          version,
          live,
          entry.mapID,
          entry.kind,
          entry.key,
          entry.name,
          entry.full,
          short,
          entry.source ?? null,
          entry.note ?? null,
        ],
      );

      stats.inserted++;
      if (live) stats.promoted++;
    }
  });

  return stats;
}

/**
 * Records translations uploaded for one language.
 *
 * Same bargain as recordRewrite, in another language: an upload may take over a
 * line that was uploaded before, and is held back behind a hand edit made in the
 * explorer -- a re-upload of a sheet must not be able to discard a correction
 * somebody made by hand, or re-uploading becomes a command nobody dares run. Held
 * back means the row is still recorded, as a non-current version underneath the
 * edit, so nothing a translator sent is lost.
 *
 * Structure -- mapID, kind, key, source -- comes from the English row: a translation
 * never decides which lines exist, and it inherits the wiki attribution because it
 * is a derivative of that text. The name is the client's for that language
 * (lib/area-names.mjs), not the sheet's: nobody translates place names here.
 *
 * @param entries [{ lineId, full, short? }] -- `short` blank means derive it.
 */
export async function recordTranslations(entries, lang) {
  if (lang === BASE_LOCALE) throw new Error("recordTranslations is for languages other than English");
  const stats = { inserted: 0, promoted: 0, unchanged: 0, heldBack: 0, unknown: [] };
  const names = await loadAreaNames();

  await transaction(async (client) => {
    for (const entry of entries) {
      const { rows: englishRows } = await client.query(
        `select "mapID", "kind", "key", "source", "name"
           from "lore_line" where "lineId" = $1 and "lang" = 'enUS' and "isCurrent"`,
        [entry.lineId],
      );
      const english = englishRows[0];
      if (!english) {
        stats.unknown.push(entry.lineId);
        continue;
      }

      const { rows: currentRows } = await client.query(
        `select "version", "origin", "name", "full", "short", "shortIsManual"
           from "lore_line" where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
        [entry.lineId, lang],
      );
      const current = currentRows[0];

      const name = areaName(names, lang, english);
      const shortIsManual = Boolean(entry.short);
      const short = shortIsManual ? entry.short : makeShort(entry.full);

      if (
        current &&
        current.full === entry.full &&
        current.name === name &&
        (!shortIsManual || current.short === short)
      ) {
        stats.unchanged++;
        continue;
      }

      const { rows: maxRows } = await client.query(
        `select coalesce(max("version"), 0) as "version"
           from "lore_line" where "lineId" = $1 and "lang" = $2`,
        [entry.lineId, lang],
      );
      const version = Number(maxRows[0].version) + 1;

      const live = !current || current.origin !== "edited";
      if (!live) stats.heldBack++;

      if (live && current) {
        await client.query(
          `update "lore_line" set "isCurrent" = false
           where "lineId" = $1 and "lang" = $2 and "isCurrent"`,
          [entry.lineId, lang],
        );
      }

      await client.query(
        `insert into "lore_line"
           ("lineId", "lang", "version", "isCurrent", "origin", "mapID", "kind", "key",
            "name", "full", "short", "shortIsManual", "source")
         values ($1, $2, $3, $4, 'translated', $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          entry.lineId,
          lang,
          version,
          live,
          english.mapID,
          english.kind,
          english.key,
          name,
          entry.full,
          short,
          shortIsManual,
          english.source,
        ],
      );

      stats.inserted++;
      if (live && current) stats.promoted++;
    }
  });

  return stats;
}

/**
 * Where a scrape's output goes.
 *
 * With a database that is the versioned table; without one it is the Lua file the
 * scraper has always written. A --only or --zone run passes `partial` so the file path
 * is skipped: those runs hold a subset of the corpus and writing it would truncate the
 * data file to whatever was scraped. The database path has no such problem -- rows are
 * keyed by lineId rather than replaced wholesale -- which is the main reason a partial
 * re-scrape is worth running at all now.
 *
 * @param zoneNames only needed on the no-database subzone path, where the emitted
 *   comment headers cannot be derived from the entries themselves.
 */
export async function persistScrape(entries, { partial = false, zoneNames = null } = {}) {
  if (isEnabled()) {
    const stats = await recordScrape(entries);
    return { target: "database", ...stats };
  }

  if (partial) return { target: "skipped" };

  const kind = entries[0]?.kind;
  const count =
    kind === "zone"
      ? await writeZonesLua(entries)
      : await writeSubzonesLua(entries, zoneNames ?? new Map());

  return { target: "lua", count };
}
