#!/usr/bin/env node
// Sanity-checks the generated Lua data files without a Lua interpreter.
//
//   node tools/validate.mjs
//
// The definitive test is loading the addon in-game, but a bad string escape there
// costs a relog to discover, so check the mechanical properties here: balanced
// structure, properly terminated strings, no raw newlines or control characters
// inside strings, deterministic ordering, and no post-vanilla lore leaking
// through the era filter.
//
// It also guards the two places where Core.lua reimplements a JS function in Lua:
// normaliseKey, and the slug half of naming.mjs that the report URLs are built from.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, normaliseKey } from "./lib/wiki.mjs";
import { loadEraAreas } from "./lib/era.mjs";
import { slugFor } from "./voice/naming.mjs";

const ZONES = join(ROOT, "addon/ZoneLore/Data/Zones.lua");
const SUBZONES = join(ROOT, "addon/ZoneLore/Data/Subzones.lua");

// Terms that should never survive the era filter. Case-sensitive where the
// lower-case word is legitimate vanilla lore ("the black dragonflight").
const FORBIDDEN = [
  /\bcataclysm\b/i,
  /\bDeathwing\b/,
  /\bPandaria\b/,
  /\bShadowlands\b/,
  /\bGarrosh\b/,
  /\bAzerite\b/,
  /\bOutland\b/,
  /\bDragonflight\b/, // the expansion; "dragonflight" the faction is fine
  /\bN'Zoth\b/,
  /\bBroken Isles\b/,
  /\bIcecrown Citadel\b/,
  /\bphas(?:ed|ing)\b/i,
  // Battle for Azeroth and Shadowlands respectively, named as events rather than
  // expansions, so nothing above caught them. Eleven shipped lines described
  // Tirisfal and Lordaeron as they stand after a war that has not happened in Era.
  /\bBattle (?:for|of) Lordaeron\b/,
  /\bthe Jailer\b/,
  // From the 2026-08 full-corpus review (dist/review-findings.md): zero
  // legitimate vanilla uses, found leaked into shipped text. Kept in step with
  // the same block in lib/wiki.mjs POST_VANILLA.
  /\bWar of the Thorns\b/,
  /\bBilgewater\b/,
  /\bsaronite\b/i,
  /\bVanessa VanCleef\b/,
  /\bDelaryn Summermoon\b/,
  /\bAlennah Starsong\b/,
  /\bLorash Sunbeam\b/,
  /\bSira Moonwarden\b/,
  /\bPrimalists?\b/,
  /\bTwilight Highlands\b/,
  /\bwarfronts?\b/i,
  /\bHorde Council\b/,
  /\bXenedar\b/,
  /\bFirelands\b/,
];

const problems = [];
const note = (msg) => problems.push(msg);

// Every generated field line, at any nesting depth.
const FIELD = /^\t+(name|short|full|source) = "(.*)",$/;

function checkStrings(src, label) {
  let fields = 0;

  src.split("\n").forEach((line, i) => {
    const lineNo = i + 1;
    if (!/^\t+\w+ = /.test(line)) return;

    const m = line.match(FIELD);
    if (!m) {
      note(`${label}:${lineNo}: field line is not a terminated Lua string: ${line.slice(0, 70)}`);
      return;
    }

    const [, field, bodyText] = m;
    fields++;

    // Walk the body checking that every " and \ is escaped.
    for (let j = 0; j < bodyText.length; j++) {
      const ch = bodyText[j];
      if (ch === "\\") {
        const next = bodyText[j + 1];
        if (next === undefined) {
          note(`${label}:${lineNo}: ${field} ends with a dangling backslash`);
        } else if (!'\\"nrt'.includes(next)) {
          note(`${label}:${lineNo}: ${field} has unknown escape \\${next}`);
        }
        j++; // consume the escaped character
      } else if (ch === '"') {
        note(`${label}:${lineNo}: ${field} contains an unescaped double quote`);
      } else if (ch.charCodeAt(0) < 0x20) {
        note(
          `${label}:${lineNo}: ${field} contains a raw control character ` +
            `(0x${ch.charCodeAt(0).toString(16)})`
        );
      }
    }

    if ((field === "full" || field === "short") && bodyText.trim().length === 0) {
      note(`${label}:${lineNo}: ${field} is empty`);
    }

    if (field === "full" || field === "short") {
      for (const re of FORBIDDEN) {
        if (re.test(bodyText)) {
          note(`${label}:${lineNo}: post-vanilla term ${re} leaked into ${field}`);
        }
      }
    }
  });

  return fields;
}

function checkBraces(src, label) {
  const opens = (src.match(/\{/g) || []).length;
  const closes = (src.match(/\}/g) || []).length;
  if (opens !== closes) {
    note(`${label}: unbalanced braces, ${opens} '{' vs ${closes} '}'`);
  }
}

function checkHeader(src, label, tableName) {
  if (!/^local _, ZoneLore = \.\.\.$/m.test(src)) {
    note(`${label}: missing the 'local _, ZoneLore = ...' vararg header`);
  }
  if (!new RegExp(`^ZoneLore\\.${tableName} = \\{$`, "m").test(src)) {
    note(`${label}: missing the 'ZoneLore.${tableName} = {' assignment`);
  }
}

//------------------------------------------------------------------------------
// Zones.lua
//------------------------------------------------------------------------------

const zonesSrc = await readFile(ZONES, "utf8");
checkBraces(zonesSrc, "Zones.lua");
checkHeader(zonesSrc, "Zones.lua", "Zones");

const zoneIDs = [...zonesSrc.matchAll(/^\t\[(\d+)\] = \{$/gm)].map((m) => Number(m[1]));
if (zoneIDs.length === 0) note("Zones.lua: no zone entries found");

const seenZones = new Set();
for (const id of zoneIDs) {
  if (seenZones.has(id)) note(`Zones.lua: duplicate uiMapID ${id}`);
  seenZones.add(id);
}
if (zoneIDs.join(",") !== [...zoneIDs].sort((a, b) => a - b).join(",")) {
  note("Zones.lua: entries are not sorted by uiMapID (output is not deterministic)");
}

const zoneFields = checkStrings(zonesSrc, "Zones.lua");
if (zoneFields !== zoneIDs.length * 4) {
  note(`Zones.lua: ${zoneFields} field lines for ${zoneIDs.length} entries (expected 4 each)`);
}

//------------------------------------------------------------------------------
// Subzones.lua
//------------------------------------------------------------------------------

const subSrc = await readFile(SUBZONES, "utf8");
checkBraces(subSrc, "Subzones.lua");
checkHeader(subSrc, "Subzones.lua", "Subzones");

const subParents = [...subSrc.matchAll(/^\t\[(\d+)\] = \{$/gm)].map((m) => Number(m[1]));
const subKeys = [...subSrc.matchAll(/^\t\t\["([^"]*)"\] = \{$/gm)].map((m) => m[1]);

if (subParents.length === 0) note("Subzones.lua: no parent zones found");
if (subKeys.length === 0) note("Subzones.lua: no subzone entries found");

// Every parent zone must itself be a known zone, or the panel can never reach it.
for (const parent of subParents) {
  if (!seenZones.has(parent)) {
    note(`Subzones.lua: parent uiMapID ${parent} is not present in Zones.lua`);
  }
}

// Keys must already be in canonical form -- the addon normalises the client's
// area name and looks it up directly, so a non-canonical key is unreachable.
for (const key of subKeys) {
  const canonical = normaliseKey(key);
  if (key !== canonical) {
    note(`Subzones.lua: key "${key}" is not canonical (expected "${canonical}") -- unreachable`);
  }
}

// Every key must be an area name the Era client can report (its own AreaTable,
// dumped into tools/seed/era-areas.json). A key outside that list is either a
// post-vanilla place the wiki category slipped in, or a name the client would
// never hand to the lookup -- unreachable either way.
const era = await loadEraAreas();
for (const key of subKeys) {
  if (!era.keys.has(key)) {
    note(`Subzones.lua: "${key}" is not an area in the Era client (build ${era.build})`);
  }
}

const subFields = checkStrings(subSrc, "Subzones.lua");
if (subFields !== subKeys.length * 4) {
  note(`Subzones.lua: ${subFields} field lines for ${subKeys.length} entries (expected 4 each)`);
}

//------------------------------------------------------------------------------
// Report URL slugs
//
// ZoneLore:ReportURL builds lore.rusty.one/r/{mapID}/{slug} in Lua, and the site
// resolves that path back to a line by looking it up among the file paths
// naming.mjs assigns. That only works while every slug is derivable from the key
// alone: assignFiles has a hash fallback for collisions, and the addon has no way
// to reproduce it, so a collision would ship a Report button that 404s.
//
// "zone" is reserved for a zone's own line, so a subzone slugging to it collides
// with its own parent.
//------------------------------------------------------------------------------

const byParent = new Map();
{
  let parent = null;
  for (const m of subSrc.matchAll(/^\t\[(\d+)\] = \{$|^\t\t\["([^"]*)"\] = \{$/gm)) {
    if (m[1] !== undefined) {
      parent = Number(m[1]);
      byParent.set(parent, []);
    } else if (parent !== null) {
      byParent.get(parent).push(m[2]);
    }
  }
}

for (const [parent, keys] of byParent) {
  const taken = new Map([["zone", "(the zone's own line)"]]);
  for (const key of keys) {
    const slug = slugFor(key);
    const other = taken.get(slug);
    if (other !== undefined) {
      note(`Subzones.lua: [${parent}] "${key}" and ${other} both slug to "${slug}" -- report URLs collide`);
    }
    taken.set(slug, `"${key}"`);
  }
}

//------------------------------------------------------------------------------
// Lua/JS parity
//
// Core.lua reimplements normaliseKey and naming.mjs's slugFor in Lua. If either
// drifts, lookups silently miss and report links point at nothing, so check the
// Lua source still performs the same steps in the same order.
//------------------------------------------------------------------------------

const coreSrc = await readFile(join(ROOT, "addon/ZoneLore/Core.lua"), "utf8");
const expectedSteps = [
  /key = name:lower\(\)/,
  /key = key:gsub\("'", ""\)/,
  /key = key:gsub\("\^the%s\+", ""\)/,
  /key = key:gsub\("\[\^a-z0-9\]\+", " "\)/,
];
for (const step of expectedSteps) {
  if (!step.test(coreSrc)) {
    note(`Core.lua: NormaliseAreaKey no longer matches lib/wiki.mjs normaliseKey (missing ${step})`);
  }
}

const expectedSlugSteps = [
  /slug = areaKey:gsub\("%s\+", "-"\)/,
  /slug = slug:gsub\("\[\^a-z0-9%-\]", ""\)/,
];
for (const step of expectedSlugSteps) {
  if (!step.test(coreSrc)) {
    note(`Core.lua: ReportURL no longer matches voice/naming.mjs slugFor (missing ${step})`);
  }
}

//------------------------------------------------------------------------------
// Report
//------------------------------------------------------------------------------

if (problems.length) {
  console.error(`FAIL -- ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

console.log(
  `OK -- Zones.lua: ${zoneIDs.length} zones ` +
    `(${(zonesSrc.length / 1024).toFixed(1)} KB, uiMapID ${Math.min(...zoneIDs)}..${Math.max(...zoneIDs)})`
);
console.log(
  `     Subzones.lua: ${subKeys.length} subzones across ${subParents.length} zones ` +
    `(${(subSrc.length / 1024).toFixed(1)} KB), all keys canonical`
);
console.log("     no era leaks, report slugs unique, Lua/JS normalisation and slugging in step");
