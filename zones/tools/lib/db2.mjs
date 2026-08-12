// Client database tables, from wago.tools.
//
// wago.tools serves Blizzard's own DB2 tables as CSV, per build and per locale.
// Two scripts read AreaTable from it -- fetch-era-areas.mjs for the set of names
// the client can report, locale/build-aliases.mjs for what those names are in
// each language -- so the build pin and the CSV reader live here rather than
// once per caller.
//
// Everything derived from these fetches is committed, so a scrape, an export or
// a validation run stays deterministic and offline.

// The Era build every generated artefact is derived from. Moving it is a
// deliberate act: the area names change, so the alias tables and the era-area
// seed both have to be regenerated and reviewed together.
export const PINNED_BUILD = "1.15.9.69109";

// Just enough CSV to read wago.tools output: quoted fields may contain commas
// and doubled quotes.
export function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * One DB2 table as an array of row objects.
 *
 * @param table e.g. "AreaTable"
 * @param opts.locale a WoW locale code. A build with no data for a locale serves
 *   the English strings rather than failing, which is why callers compare
 *   against English instead of trusting that a request for deDE returned German.
 */
export async function fetchTable(table, { build = PINNED_BUILD, locale = "enUS" } = {}) {
  const url = `https://wago.tools/db2/${table}/csv?build=${build}&locale=${locale}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url} -- is ${build} a real Era build?`);

  const lines = (await res.text()).trim().split("\n");
  const header = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const fields = parseCsvLine(line);
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i];
    return row;
  });
}
