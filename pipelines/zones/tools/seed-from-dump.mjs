#!/usr/bin/env node
// Rebuilds a candidate tools/seed/zones.json from a live client map dump.
//
//   in-game:  /zl dump   then  /reload
//   here:     node tools/seed-from-dump.mjs [--write]
//
// Without --write it only reports differences against the current seed, which is
// the useful mode: it tells you whether any hand-entered uiMapID is wrong.
//
// Reads ZoneLoreDB.dump out of the SavedVariables file. That file is Lua, but the
// dump has a fixed shape, so it is scanned rather than interpreted.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "tools/seed/zones.json");
const WTF = "/Applications/World of Warcraft/_classic_era_/WTF/Account";

const write = process.argv.includes("--write");

// Map types worth having lore for. Dungeon/Micro/Orphan are skipped.
const WANTED = new Set(["World", "Continent", "Zone"]);

async function findSavedVariables() {
  if (!existsSync(WTF)) {
    throw new Error(`no WTF/Account directory at ${WTF}`);
  }
  const accounts = await readdir(WTF);
  const candidates = [];
  for (const account of accounts) {
    const p = join(WTF, account, "SavedVariables", "ZoneLore.lua");
    if (existsSync(p)) candidates.push(p);
  }
  if (candidates.length === 0) {
    throw new Error(
      "no ZoneLore.lua in any account's SavedVariables.\n" +
        "Run `/zl dump` then `/reload` in-game first."
    );
  }
  return candidates[0];
}

// Each dumped map is a Lua table literal with known keys. Pull them per-block.
function parseDump(lua) {
  const start = lua.indexOf('["dump"]');
  if (start < 0) {
    throw new Error('no ["dump"] key found -- run `/zl dump` then `/reload` in-game');
  }

  const maps = [];
  const blockRe = /\{\s*([^{}]*?)\s*\}/gs;
  const region = lua.slice(start);

  for (const m of region.matchAll(blockRe)) {
    const block = m[1];
    const num = (key) => {
      const hit = block.match(new RegExp(`\\["${key}"\\]\\s*=\\s*(-?\\d+)`));
      return hit ? Number(hit[1]) : null;
    };
    const str = (key) => {
      const hit = block.match(new RegExp(`\\["${key}"\\]\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      return hit ? hit[1].replace(/\\"/g, '"') : null;
    };

    const mapID = num("mapID");
    const name = str("name");
    if (mapID !== null && name) {
      maps.push({ mapID, name, mapTypeName: str("mapTypeName") });
    }
  }

  if (maps.length === 0) {
    throw new Error("found the dump key but parsed no map entries");
  }
  return maps;
}

const svPath = await findSavedVariables();
console.log(`reading ${svPath}`);

const maps = parseDump(await readFile(svPath, "utf8"));
const wanted = maps.filter((m) => WANTED.has(m.mapTypeName));
console.log(`dump contains ${maps.length} maps, ${wanted.length} of type World/Continent/Zone`);

const seedRaw = JSON.parse(await readFile(SEED, "utf8"));
const comment = seedRaw._comment;
const seed = Object.entries(seedRaw).filter(([k]) => !k.startsWith("_"));
const seedByID = new Map(seed.map(([k, v]) => [Number(k), v]));
const clientByID = new Map(wanted.map((m) => [m.mapID, m]));

// --- differences -----------------------------------------------------------

let issues = 0;

for (const [mapID, meta] of seedByID) {
  const client = clientByID.get(mapID);
  if (!client) {
    const anyType = maps.find((m) => m.mapID === mapID);
    if (anyType) {
      console.log(`  ~ ${mapID} "${meta.name}": client says type ${anyType.mapTypeName}, not a zone`);
    } else {
      console.log(`  ! ${mapID} "${meta.name}": not present in the client dump at all`);
      issues++;
    }
  } else if (client.name !== meta.name) {
    console.log(`  ! ${mapID}: seed says "${meta.name}", client says "${client.name}"`);
    issues++;
  }
}

for (const [mapID, client] of clientByID) {
  if (!seedByID.has(mapID)) {
    console.log(`  + ${mapID} "${client.name}": in the client but missing from the seed`);
  }
}

console.log(issues === 0 ? "\nseed agrees with the client" : `\n${issues} mismatch(es)`);

// --- optional rewrite ------------------------------------------------------

if (write) {
  const out = { _comment: comment };
  for (const m of wanted.sort((a, b) => a.mapID - b.mapID)) {
    const existing = seedByID.get(m.mapID);
    out[String(m.mapID)] = existing?.wiki
      ? { name: m.name, wiki: existing.wiki }
      : { name: m.name };
  }
  await writeFile(SEED, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nrewrote ${SEED} with ${wanted.length} entries from the client`);
  console.log("review the diff, then re-run: node tools/scrape.mjs");
}
