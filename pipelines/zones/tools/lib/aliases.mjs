// The place names a localised client reports, read back out of the addon's alias tables.
//
// Data/<locale>/Aliases.lua maps each name a client in that locale shows to the English key
// the corpus is stored under -- built from the game's own AreaTable, so it is the name the
// player actually sees. Read the other way round, it is that language's name for each zone
// and subzone, which is what entity_name holds.

import { normaliseKey } from "./wiki.mjs";

/** `["Abtei von Nordhain"] = "northshire abbey",` -> [["Abtei von Nordhain", "northshire abbey"]] */
export function parseAliases(lua) {
  const pairs = [];
  const entry = /^\s*\["((?:[^"\\]|\\.)*)"\]\s*=\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
  for (const match of lua.matchAll(entry)) {
    pairs.push([unescape(match[1]), unescape(match[2])]);
  }
  return pairs;
}

function unescape(text) {
  return text.replace(/\\(.)/g, "$1");
}

/**
 * entity_name rows for the lore lines whose key a localised name maps to.
 *
 * A subzone is matched on its key, a zone on its normalised name (a zone line has no key).
 * Where a key is reached from two localised names -- a place renamed between builds keeps
 * both -- the first in the file stands; where one key names subzones in several zones,
 * each of them gets it, since it is the same place name.
 *
 * @param lines English lore_line rows: { lineId, kind, key, name }
 * @param pairs parseAliases' output
 */
export function namesFromAliases(lines, pairs) {
  const byKey = new Map();
  for (const [localised, key] of pairs) if (!byKey.has(key)) byKey.set(key, localised);

  const names = [];
  for (const line of lines) {
    const key = line.kind === "subzone" ? line.key : normaliseKey(line.name);
    const localised = key ? byKey.get(key) : undefined;
    if (localised) names.push({ kind: line.kind, entityId: line.lineId, name: localised });
  }
  return names;
}
