// Reads the generated Lua data files back into JS records.
//
// Both files are machine-written by tools/scrape*.mjs with a fixed shape, one
// field per line, so a regex reader is enough and keeps the repo free of a Lua
// interpreter -- the same bet tools/validate.mjs already makes.
//
// Used by tools/voice/* and by validate.mjs, so there is one parser rather than
// one per consumer.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The repo root. Everything under tools/ derives its paths from this one constant.
//
// The override is what makes the explorer deployable. Next bundles these modules with
// webpack, which replaces `import.meta.url` with the *build machine's* path -- so a
// bundle built in CI carries a literal
// "file:///home/runner/work/wow-lore/wow-lore/tools/lib/loredata.mjs" and every path
// below it resolves to a directory that does not exist on the droplet. Deriving the
// root from the module's own location is right for a script and impossible for a
// bundle, so a deployed process says where the root is instead.
//
// Unset -- which is every local run, CLI or `next dev` -- this behaves exactly as it
// did before. See deploy/README.md for the full set.
export const ROOT =
  process.env.ZONELORE_ROOT || join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ZONES_LUA = join(ROOT, "addon/ZoneLore/Data/Zones.lua");
export const SUBZONES_LUA = join(ROOT, "addon/ZoneLore/Data/Subzones.lua");

// The emitter escapes exactly these, so the reader reverses exactly these.
function unescapeLua(text) {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function fields(block) {
  const out = {};
  for (const [, key, value] of block.matchAll(
    /^\t+(name|short|full|source) = "((?:[^"\\]|\\.)*)",$/gm,
  )) {
    out[key] = unescapeLua(value);
  }
  return out;
}

export async function readZones() {
  const src = await readFile(ZONES_LUA, "utf8");
  const zones = [];

  // Split on the top-level "[id] = {" headers, so each block is one zone.
  const parts = src.split(/^\t\[(\d+)\] = \{$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const mapID = Number(parts[i]);
    zones.push({ mapID, ...fields(parts[i + 1]) });
  }
  return zones;
}

export async function readSubzones() {
  const src = await readFile(SUBZONES_LUA, "utf8");
  const subzones = [];

  const zoneParts = src.split(/^\t\[(\d+)\] = \{$/m);
  for (let i = 1; i < zoneParts.length; i += 2) {
    const mapID = Number(zoneParts[i]);

    const keyParts = zoneParts[i + 1].split(/^\t\t\["([^"]*)"\] = \{$/m);
    for (let j = 1; j < keyParts.length; j += 2) {
      subzones.push({ mapID, key: keyParts[j], ...fields(keyParts[j + 1]) });
    }
  }
  return subzones;
}

// Every voiceable entry, in a single shape. `key` is null for a zone.
export async function readLines() {
  const [zones, subzones] = await Promise.all([readZones(), readSubzones()]);
  return [
    ...zones.map((z) => ({ ...z, key: null, kind: "zone" })),
    ...subzones.map((s) => ({ ...s, kind: "subzone" })),
  ];
}
