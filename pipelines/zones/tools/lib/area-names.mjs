// What each zone and subzone is called in a language, from the client's own AreaTable.
//
// Not read back out of Data/<locale>/Aliases.lua, which is what this used to do. That table
// is built for the addon's lookup and is right for it, but it leaves out two kinds of name
// the site needs: zones (the addon never looks a zone up by name, so it only carried the few
// that share a name with a subzone) and names that are the same in both languages (a Latin
// client normalises its way to those without help). Read as a list of translations, both
// came out as untranslated, so Mulgore sat in the Spanish explorer as English when it is
// simply Mulgore in Spanish too.

import { normaliseKey } from "./wiki.mjs";

/**
 * English key -> localised name, for the keys asked for.
 *
 * AreaTable carries both names against one ID, so this is a join. Several rows can share an
 * English name (a zone and its like-named area, an instance entrance); the first localised
 * name wins, as it does in the alias tables.
 *
 * @param english AreaTable rows in English: { ID, AreaName_lang }
 * @param localised the same table in the language
 * @param wanted the keys worth keeping -- the corpus's, zones and subzones alike
 */
export function areaNames(english, localised, wanted) {
  const englishById = new Map(english.map((row) => [row.ID, (row.AreaName_lang || "").trim()]));
  const names = new Map();
  for (const row of localised) {
    const name = (row.AreaName_lang || "").trim();
    const englishName = englishById.get(row.ID);
    if (!name || !englishName) continue;
    const key = normaliseKey(englishName);
    if (wanted.has(key) && !names.has(key)) names.set(key, name);
  }
  return names;
}

/**
 * entity_name rows for the lore lines a language names.
 *
 * A subzone is matched on its key and a zone on its normalised name, since a zone line has
 * no key. Where one key names subzones in several zones, each of them gets it: it is the
 * same place name.
 *
 * @param lines English lore_line rows: { lineId, kind, key, name }
 * @param names English key -> localised name, as the seed stores it for one language
 */
export function namesForLines(lines, names) {
  const out = [];
  for (const line of lines) {
    const key = line.kind === "subzone" ? line.key : normaliseKey(line.name);
    const name = key ? names[key] : undefined;
    if (name) out.push({ kind: line.kind, entityId: line.lineId, name });
  }
  return out;
}
