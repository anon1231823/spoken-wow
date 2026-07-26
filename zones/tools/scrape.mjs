#!/usr/bin/env node
// Builds addon/ZoneLore/Data/Zones.lua from warcraft.wiki.gg page intros.
//
//   node tools/scrape.mjs                 # use cache where present
//   node tools/scrape.mjs --refresh       # re-fetch everything
//   node tools/scrape.mjs --only 1411     # single zone, useful when tuning
//   node tools/scrape.mjs --no-era-filter # keep post-vanilla paragraphs
//   node tools/scrape.mjs --verbose       # show what the era filter dropped
//
// Requires Node 18+ (built-in fetch). No dependencies.
//
// Lore text is CC BY-SA 4.0 from warcraft.wiki.gg contributors.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "tools/seed/zones.json");
const OVERRIDES = join(ROOT, "tools/seed/overrides.json");
const CACHE = join(ROOT, "tools/cache");
const OUT = join(ROOT, "addon/ZoneLore/Data/Zones.lua");

const API = "https://warcraft.wiki.gg/api.php";
const WIKI = "https://warcraft.wiki.gg/wiki/";
const USER_AGENT =
  "ZoneLore-addon-build/0.1 (WoW Classic Era addon; +https://warcraft.wiki.gg/wiki/Special:MyPage)";
const THROTTLE_MS = 500;

const argv = process.argv.slice(2);
const flags = {
  refresh: argv.includes("--refresh"),
  eraFilter: !argv.includes("--no-era-filter"),
  verbose: argv.includes("--verbose"),
  only: (() => {
    const i = argv.indexOf("--only");
    return i >= 0 ? argv[i + 1] : null;
  })(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//------------------------------------------------------------------------------
// Era filtering
//
// Wiki leads narrate a zone across every expansion, so a Classic Era addon would
// otherwise tell players about Deathwing and Pandaria. Drop paragraphs anchored
// in post-vanilla events.
//
// Deliberately NOT markers, because vanilla lore uses them legitimately:
//   Draenor, Burning Legion, Northrend, Lich King, Scourge, Naxxramas,
//   Third War, Dark Portal, Grom Hellscream.
//------------------------------------------------------------------------------

const POST_VANILLA = [
  // Case-insensitive: the wiki also writes "until the cataclysm, the huge lake
  // ..." in lower case, and in Era that lake is still full of water. A rare
  // false positive on a Sundering reference is cheaper than wrong-era geography;
  // use overrides.json if one shows up.
  /\bcataclysm\b/i,
  /\bthe [Ss]hattering\b/,
  /\bDeathwing\b/,
  /\bGarrosh\b/,
  /\bVol'jin\b/,
  /\b[Tt]he Burning Crusade\b/,
  /\bOutland\b/,
  /\bWrath of the Lich King\b/,
  /\bIcecrown Citadel\b/,
  /\bMists of Pandaria\b/,
  /\bPandaria\b/,
  /\bpandaren\b/i,
  /\bWarlords of Draenor\b/,
  /\bBroken Isles\b/,
  /\bArgus\b/,
  /\bBattle for Azeroth\b/,
  /\bAzerite\b/,
  /\bN'Zoth\b/,
  /\bFourth War\b/,
  /\bSiege of Orgrimmar\b/,
  /\bShadowlands\b/,
  /\bDragonflight\b/,
  /\bDragon Isles\b/,
  /\b[Tt]he War Within\b/,
  /\bWorld of Warcraft:\s/,
  /\bpatch \d+\.\d+/i,
  /^(?:After|Following|During|Since)\s+the\s+(?:Cataclysm|Shattering|Fourth War)/,
];

// "Legion" alone is too blunt -- vanilla constantly references the Burning
// Legion. Only treat it as post-vanilla when it reads as the expansion name.
const LEGION_EXPANSION = /\b(?:the\s+)?Legion\s+(?:expansion|invasion of Azeroth)\b|\bWorld of Warcraft: Legion\b/;

function isPostVanilla(paragraph) {
  for (const re of POST_VANILLA) {
    if (re.test(paragraph)) return re.source;
  }
  // "Legion" needs its own pass: vanilla lore references the Burning Legion
  // constantly, so only the expansion-name reading counts as post-vanilla.
  if (LEGION_EXPANSION.test(paragraph)) return LEGION_EXPANSION.source;
  return null;
}

//------------------------------------------------------------------------------
// Text cleanup
//------------------------------------------------------------------------------

function normalise(text) {
  return text
    // Pronunciation guides read as line noise in-game: "Tanaris (/təˈnɛə.ɹɪs/
    // tə-NAYR-iss or ...) is a desert" -> "Tanaris is a desert".
    .replace(/\s*\(\s*\/[^)]*\)/g, "")
    .replace(/’|‘/g, "'")
    .replace(/“|”/g, '"')
    .replace(/—/g, " -- ")
    .replace(/–/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/\[\d+\]/g, "") // reference markers
    .replace(/[ \t]+/g, " ")
    .trim();
}

function splitSentences(paragraph) {
  // Split on sentence punctuation followed by an opening-looking token. Good
  // enough for encyclopedic prose; keeps "e.g." and "Mt. Hyjal" intact.
  return paragraph.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
}

// Filter per sentence, not per paragraph. Many wiki intros are a single
// paragraph that is mostly timeless description with one clause about a later
// expansion -- dropping the whole paragraph loses good vanilla lore, and
// keeping it shows players Cataclysm content.
function cleanExtract(raw, { verbose }) {
  const paragraphs = raw
    .split(/\n+/)
    .map((p) => normalise(p))
    // Section headings survive explaintext as bare "== Foo ==" lines.
    .filter((p) => p.length > 0 && !/^=+.*=+$/.test(p));

  const keptParagraphs = [];
  const dropped = [];

  for (const p of paragraphs) {
    if (!flags.eraFilter) {
      keptParagraphs.push(p);
      continue;
    }

    const keptSentences = [];
    for (const sentence of splitSentences(p)) {
      const reason = isPostVanilla(sentence);
      if (reason) {
        dropped.push({ text: sentence, reason });
      } else {
        keptSentences.push(sentence);
      }
    }

    if (keptSentences.length > 0) {
      keptParagraphs.push(keptSentences.join(" "));
    }
  }

  if (verbose && dropped.length > 0) {
    for (const d of dropped) {
      console.log(`    drop [${d.reason}] ${d.text.slice(0, 80)}...`);
    }
  }

  return {
    full: keptParagraphs.join("\n\n"),
    droppedCount: dropped.length,
    empty: keptParagraphs.length === 0 && paragraphs.length > 0,
  };
}

// First one or two sentences, for the map hover preview.
function makeShort(full, limit = 220) {
  const firstPara = full.split("\n\n")[0] || "";
  const sentences = firstPara.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    if (out && (out + " " + s).length > limit) break;
    out = out ? out + " " + s : s;
    if (out.length >= limit * 0.6) break;
  }
  if (!out) out = firstPara.slice(0, limit);
  return out.trim();
}

//------------------------------------------------------------------------------
// Fetching
//------------------------------------------------------------------------------

function cachePath(title) {
  return join(CACHE, encodeURIComponent(title) + ".json");
}

async function fetchExtract(title) {
  const path = cachePath(title);
  if (!flags.refresh && existsSync(path)) {
    return { json: JSON.parse(await readFile(path, "utf8")), cached: true };
  }

  const url =
    `${API}?action=query&format=json&formatversion=2&redirects=1` +
    `&prop=extracts&explaintext=1&exintro=1&titles=${encodeURIComponent(title)}`;

  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${title}`);
  const json = await res.json();

  await mkdir(CACHE, { recursive: true });
  await writeFile(path, JSON.stringify(json, null, 2));
  await sleep(THROTTLE_MS);
  return { json, cached: false };
}

function extractFromResponse(json, title) {
  const pages = json?.query?.pages;
  if (!pages) return null;
  const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
  if (!page || page.missing) return null;
  const text = page.extract;
  if (!text || !text.trim()) return null;
  return { text, resolvedTitle: page.title || title };
}

//------------------------------------------------------------------------------
// Lua emission
//------------------------------------------------------------------------------

function luaString(s) {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n")
      // Strip control characters rather than emitting raw bytes into Lua source.
      .replace(/[ -]/g, " ") +
    '"'
  );
}

function emitLua(entries) {
  const lines = [
    "-- AUTO-GENERATED by tools/scrape.mjs. Do not edit by hand; your changes will",
    "-- be overwritten. Adjust tools/seed/zones.json or the scraper instead.",
    "--",
    "-- Lore text from warcraft.wiki.gg, licensed CC BY-SA 4.0.",
    "-- Page intros only, with post-vanilla paragraphs filtered out for Classic Era.",
    "",
    "local _, ZoneLore = ...",
    "",
    "ZoneLore.Zones = {",
  ];

  for (const e of entries) {
    lines.push(`\t[${e.mapID}] = {`);
    lines.push(`\t\tname = ${luaString(e.name)},`);
    lines.push(`\t\tshort = ${luaString(e.short)},`);
    lines.push(`\t\tfull = ${luaString(e.full)},`);
    lines.push(`\t\tsource = ${luaString(e.source)},`);
    lines.push("\t},");
  }

  lines.push("}", "");
  return lines.join("\n");
}

//------------------------------------------------------------------------------

async function main() {
  const seedRaw = JSON.parse(await readFile(SEED, "utf8"));
  const seed = Object.entries(seedRaw).filter(([k]) => !k.startsWith("_"));

  const overridesRaw = existsSync(OVERRIDES)
    ? JSON.parse(await readFile(OVERRIDES, "utf8"))
    : {};
  const overrides = Object.fromEntries(
    Object.entries(overridesRaw).filter(([k]) => !k.startsWith("_"))
  );

  const targets = flags.only
    ? seed.filter(([id]) => id === String(flags.only))
    : seed;

  if (targets.length === 0) {
    console.error(`no seed entry matched --only ${flags.only}`);
    process.exit(1);
  }

  console.log(
    `scraping ${targets.length} zone(s) from warcraft.wiki.gg ` +
      `(era filter ${flags.eraFilter ? "on" : "off"})`
  );

  const entries = [];
  const problems = [];
  let fetched = 0;
  let cached = 0;

  for (const [idStr, meta] of targets) {
    const mapID = Number(idStr);
    const title = meta.wiki || meta.name;

    let result;
    try {
      result = await fetchExtract(title);
    } catch (err) {
      problems.push(`${title} (${mapID}): ${err.message}`);
      continue;
    }
    result.cached ? cached++ : fetched++;

    const found = extractFromResponse(result.json, title);
    if (!found) {
      problems.push(`${title} (${mapID}): no extract returned -- check the page title`);
      continue;
    }

    const cleaned = cleanExtract(found.text, { verbose: flags.verbose });
    const override = overrides[idStr];

    // A hand-written override wins outright, and is the escape hatch for zones
    // whose wiki intro is entirely post-vanilla.
    const full = override?.full ?? cleaned.full;
    if (!full) {
      problems.push(
        `${title} (${mapID}): nothing left after era filtering -- ` +
          `add an entry to tools/seed/overrides.json`
      );
      continue;
    }

    entries.push({
      mapID,
      name: meta.name,
      short: override?.short ?? makeShort(full),
      full,
      source: WIKI + encodeURIComponent(found.resolvedTitle.replace(/ /g, "_")),
    });

    const note = [];
    if (override) note.push("override");
    if (cleaned.droppedCount) note.push(`-${cleaned.droppedCount} sentence`);
    console.log(
      `  ${String(mapID).padStart(4)} ${meta.name.padEnd(22)} ` +
        `${String(full.length).padStart(5)} chars` +
        (note.length ? `  (${note.join(", ")})` : "")
    );
  }

  entries.sort((a, b) => a.mapID - b.mapID);

  // Only rewrite the whole data file on a full run; --only would otherwise
  // truncate it to a single zone.
  if (flags.only) {
    console.log("\n--only run: not writing Data/Zones.lua");
  } else {
    await mkdir(dirname(OUT), { recursive: true });
    await writeFile(OUT, emitLua(entries));
    console.log(`\nwrote ${OUT} (${entries.length} zones)`);
  }

  console.log(`fetched ${fetched}, from cache ${cached}`);
  if (problems.length) {
    console.log(`\n${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ! ${p}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
