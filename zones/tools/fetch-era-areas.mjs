#!/usr/bin/env node
// Writes tools/seed/era-areas.json from the Classic Era client's AreaTable.
//
//   node tools/fetch-era-areas.mjs                     # pinned build
//   node tools/fetch-era-areas.mjs --build 1.15.9.69109
//
// AreaTable is the table GetSubZoneText and MapUtil.FindBestAreaNameAtMouse
// read from, so it is the definitive list of area names the Era client can ever
// report. The wiki's subzone categories mix every era of the game -- Cataclysm's
// Ruins of Auberdine, BfA's warfront Stromgarde, even Plunderstorm -- and 497 of
// the corpus's 1304 subzones turned out not to exist in the client at all.
// Everything that consumes the corpus filters against this seed instead of
// trusting the wiki's idea of what is a place.
//
// The dump comes from wago.tools, which serves Blizzard's own client database
// per build. The result is committed so scrapes and validation stay
// deterministic and offline; re-run this only to move to a newer client build.
//
// One quirk worth knowing: Season of Discovery runs on the same 1.15 client, so
// its areas are in this table too. Almost all of them are phased copies reusing
// vanilla names; the one SoD-only name that reaches the corpus is Storm Cliffs
// in Azshara. Kept deliberately -- the filter's contract is "the client can
// report this name", not "this is vanilla lore".

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ROOT } from "./lib/wiki.mjs";

const PINNED_BUILD = "1.15.9.69109";
const SEED = join(ROOT, "tools/seed/era-areas.json");

const argv = process.argv.slice(2);
const build = argv.includes("--build") ? argv[argv.indexOf("--build") + 1] : PINNED_BUILD;

// Just enough CSV to read wago.tools output: quoted fields may contain commas
// and doubled quotes.
function parseCsvLine(line) {
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

async function main() {
  const url = `https://wago.tools/db2/AreaTable/csv?build=${build}`;
  console.log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} -- is ${build} a real Era build?`);
  const csv = await res.text();

  const lines = csv.trim().split("\n");
  const header = parseCsvLine(lines[0]);
  const nameCol = header.indexOf("AreaName_lang");
  if (nameCol < 0) throw new Error("AreaTable format changed: no AreaName_lang column");

  const names = new Set();
  for (const line of lines.slice(1)) {
    const name = parseCsvLine(line)[nameCol].trim();
    if (name) names.add(name);
  }

  const seed = {
    _comment: [
      "Every area name the Classic Era client can report, from the client's own",
      "AreaTable via wago.tools. The ground truth that keeps post-vanilla places",
      "(which the wiki's subzone categories are full of) out of the corpus.",
      "Regenerate with:  node tools/fetch-era-areas.mjs",
    ],
    build,
    names: [...names].sort(),
  };
  await writeFile(SEED, JSON.stringify(seed, null, 2) + "\n");
  console.log(`wrote ${SEED}: ${names.size} unique area names from build ${build}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
