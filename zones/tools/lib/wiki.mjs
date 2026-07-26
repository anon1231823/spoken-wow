// Shared warcraft.wiki.gg fetching, era filtering and Lua emission.
// Used by tools/scrape.mjs (zones) and tools/scrape-subzones.mjs (subzones).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CACHE = join(ROOT, "tools/cache");

export const API = "https://warcraft.wiki.gg/api.php";
export const WIKI = "https://warcraft.wiki.gg/wiki/";
export const USER_AGENT =
  "ZoneLore-addon-build/0.1 (WoW Classic Era addon; +https://warcraft.wiki.gg/wiki/Special:MyPage)";
export const THROTTLE_MS = 500;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

//------------------------------------------------------------------------------
// Era filtering
//
// Wiki articles narrate a place across every expansion, so a Classic Era addon
// would otherwise describe Deathwing and Pandaria. Markers are matched per
// sentence (see cleanExtract).
//
// Deliberately NOT markers, because vanilla lore uses them legitimately:
//   Draenor, Burning Legion, Northrend, Lich King, Scourge, Naxxramas,
//   Third War, Dark Portal, Grom Hellscream, lower-case "dragonflight".
//------------------------------------------------------------------------------

export const POST_VANILLA = [
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
  // Quest phasing arrived in Wrath/Cataclysm; subzone articles use it to
  // describe post-vanilla quest hubs that do not exist in Era.
  /\bphas(?:ed|ing)\b/i,
  /^(?:After|Following|During|Since)\s+the\s+(?:Cataclysm|Shattering|Fourth War)/,
];

// "Legion" needs its own pass: vanilla lore references the Burning Legion
// constantly, so only the expansion-name reading counts as post-vanilla.
const LEGION_EXPANSION =
  /\b(?:the\s+)?Legion\s+(?:expansion|invasion of Azeroth)\b|\bWorld of Warcraft: Legion\b/;

export function isPostVanilla(text) {
  for (const re of POST_VANILLA) {
    if (re.test(text)) return re.source;
  }
  if (LEGION_EXPANSION.test(text)) return LEGION_EXPANSION.source;
  return null;
}

//------------------------------------------------------------------------------
// Text cleanup
//------------------------------------------------------------------------------

export function normalise(text) {
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

export function splitSentences(paragraph) {
  // Split on sentence punctuation followed by an opening-looking token. Good
  // enough for encyclopedic prose; keeps "e.g." and "Mt. Hyjal" intact.
  return paragraph.split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/);
}

// Filter per sentence, not per paragraph. Many wiki intros are a single
// paragraph that is mostly timeless description with one clause about a later
// expansion -- dropping the whole paragraph loses good vanilla lore, and keeping
// it shows players Cataclysm content.
export function cleanExtract(raw, { eraFilter = true, verbose = false } = {}) {
  const paragraphs = raw
    .split(/\n+/)
    .map((p) => normalise(p))
    // Section headings survive explaintext as bare "== Foo ==" lines.
    .filter((p) => p.length > 0 && !/^=+.*=+$/.test(p));

  const keptParagraphs = [];
  const dropped = [];

  for (const p of paragraphs) {
    if (!eraFilter) {
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

// First one or two sentences, for hover previews and list summaries.
export function makeShort(full, limit = 220) {
  const firstPara = full.split("\n\n")[0] || "";
  const sentences = splitSentences(firstPara);
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
// Lookup-key normalisation
//
// Subzone lore is keyed by name because MapUtil.FindBestAreaNameAtMouse returns
// a name, not an ID. Client and wiki disagree on cosmetic details -- the wiki
// titles a page "Bulwark" while the client reports "The Bulwark" -- so both
// sides are reduced to the same canonical form.
//------------------------------------------------------------------------------

export function normaliseKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

//------------------------------------------------------------------------------
// Fetching
//------------------------------------------------------------------------------

function cachePath(key) {
  return join(CACHE, encodeURIComponent(key) + ".json");
}

// Fetch any API query with on-disk caching. `key` names the cache entry.
export async function cachedQuery(query, key, { refresh = false } = {}) {
  const path = cachePath(key);
  if (!refresh && existsSync(path)) {
    return { json: JSON.parse(await readFile(path, "utf8")), cached: true };
  }

  const res = await fetch(`${API}?${query}`, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${key}`);
  const json = await res.json();

  await mkdir(CACHE, { recursive: true });
  await writeFile(path, JSON.stringify(json, null, 2));
  await sleep(THROTTLE_MS);
  return { json, cached: false };
}

export async function fetchExtract(title, opts = {}) {
  const query =
    `action=query&format=json&formatversion=2&redirects=1` +
    `&prop=extracts&explaintext=1&exintro=1&titles=${encodeURIComponent(title)}`;
  return cachedQuery(query, title, opts);
}

// All page members of a category, following continuation.
export async function fetchCategoryMembers(category, opts = {}) {
  const members = [];
  let cont = null;
  let page = 0;

  do {
    const query =
      `action=query&format=json&formatversion=2&list=categorymembers&cmtype=page` +
      `&cmlimit=500&cmtitle=${encodeURIComponent("Category:" + category)}` +
      (cont ? `&cmcontinue=${encodeURIComponent(cont)}` : "");
    const { json } = await cachedQuery(query, `category-${category}-${page}`, opts);
    for (const m of json?.query?.categorymembers || []) {
      members.push(m.title);
    }
    cont = json?.continue?.cmcontinue || null;
    page++;
  } while (cont);

  return members;
}

export function extractFromResponse(json, title) {
  const pages = json?.query?.pages;
  if (!pages) return null;
  const page = Array.isArray(pages) ? pages[0] : Object.values(pages)[0];
  if (!page || page.missing) return null;
  const text = page.extract;
  if (!text || !text.trim()) return null;
  return { text, resolvedTitle: page.title || title };
}

export function sourceUrl(title) {
  return WIKI + encodeURIComponent(title.replace(/ /g, "_"));
}

//------------------------------------------------------------------------------
// Lua emission
//------------------------------------------------------------------------------

export function luaString(s) {
  return (
    '"' +
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n")
      // Strip control characters rather than emitting raw bytes into Lua source.
      .replace(/[\x00-\x1f]/g, " ") +
    '"'
  );
}

// Strip the `_comment` documentation keys used in the seed files.
export function withoutComments(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("_")));
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonIfExists(path) {
  return existsSync(path) ? readJson(path) : {};
}
