#!/usr/bin/env node
// Sanity-checks addon/ZoneLore/Data/Zones.lua without a Lua interpreter.
//
//   node tools/validate.mjs
//
// The definitive test is loading the addon in-game, but a bad string escape
// there costs a relog to discover, so check the mechanical properties here:
// balanced structure, properly terminated strings, no raw newlines or control
// characters inside strings, no post-vanilla lore leaking through the filter.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "addon/ZoneLore/Data/Zones.lua");

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
];

const problems = [];
const src = await readFile(DATA, "utf8");
const lines = src.split("\n");

// --- structure -------------------------------------------------------------

const opens = (src.match(/\{/g) || []).length;
const closes = (src.match(/\}/g) || []).length;
if (opens !== closes) {
  problems.push(`unbalanced braces: ${opens} '{' vs ${closes} '}'`);
}

if (!/^local _, ZoneLore = \.\.\.$/m.test(src)) {
  problems.push("missing the `local _, ZoneLore = ...` vararg header");
}
if (!/^ZoneLore\.Zones = \{$/m.test(src)) {
  problems.push("missing the `ZoneLore.Zones = {` assignment");
}

// --- per-entry -------------------------------------------------------------

const ids = [...src.matchAll(/^\t\[(\d+)\] = \{$/gm)].map((m) => Number(m[1]));
if (ids.length === 0) {
  problems.push("no zone entries found");
}

const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) problems.push(`duplicate uiMapID ${id}`);
  seen.add(id);
}

const sorted = [...ids].sort((a, b) => a - b);
if (ids.join(",") !== sorted.join(",")) {
  problems.push("entries are not sorted by uiMapID (output is not deterministic)");
}

// --- strings ---------------------------------------------------------------

const FIELD = /^\t\t(name|short|full|source) = "(.*)",$/;
const fieldCounts = { name: 0, short: 0, full: 0, source: 0 };

lines.forEach((line, i) => {
  const lineNo = i + 1;
  if (!/^\t\t\w+ = /.test(line)) return;

  const m = line.match(FIELD);
  if (!m) {
    problems.push(`${lineNo}: field line does not parse as a terminated Lua string: ${line.slice(0, 70)}`);
    return;
  }

  const [, field, body] = m;
  fieldCounts[field]++;

  // Walk the string body checking that every " and \ is escaped.
  for (let j = 0; j < body.length; j++) {
    const ch = body[j];
    if (ch === "\\") {
      const next = body[j + 1];
      if (next === undefined) {
        problems.push(`${lineNo}: ${field} ends with a dangling backslash`);
      } else if (!'\\"nrt'.includes(next)) {
        problems.push(`${lineNo}: ${field} has unknown escape \\${next}`);
      }
      j++; // consume the escaped character
    } else if (ch === '"') {
      problems.push(`${lineNo}: ${field} contains an unescaped double quote`);
    } else if (ch.charCodeAt(0) < 0x20) {
      problems.push(`${lineNo}: ${field} contains a raw control character (0x${ch.charCodeAt(0).toString(16)})`);
    }
  }

  if ((field === "full" || field === "short") && body.trim().length === 0) {
    problems.push(`${lineNo}: ${field} is empty`);
  }

  if (field === "full" || field === "short") {
    for (const re of FORBIDDEN) {
      if (re.test(body)) {
        problems.push(`${lineNo}: post-vanilla term ${re} leaked into ${field}`);
      }
    }
  }
});

for (const [field, count] of Object.entries(fieldCounts)) {
  if (count !== ids.length) {
    problems.push(`${count} '${field}' fields for ${ids.length} entries -- some are missing`);
  }
}

// --- report ----------------------------------------------------------------

if (problems.length) {
  console.error(`FAIL -- ${problems.length} problem(s) in ${DATA}:`);
  for (const p of problems) console.error(`  ! ${p}`);
  process.exit(1);
}

console.log(
  `OK -- ${ids.length} zones, ${(src.length / 1024).toFixed(1)} KB, ` +
    `uiMapID ${sorted[0]}..${sorted[sorted.length - 1]}, no era leaks`
);
