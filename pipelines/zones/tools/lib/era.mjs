// The set of area names the Classic Era client can actually report.
//
// Loaded from tools/seed/era-areas.json, a committed dump of the client's own
// AreaTable (see fetch-era-areas.mjs for provenance). Corpus keys are normalised
// area names, so the set is normalised the same way here and membership is the
// whole test: a key outside it belongs to a place the Era client does not have,
// and no scrape, export or voice line should be spent on it.

import { join } from "node:path";

import { ROOT, normaliseKey, readJson } from "./wiki.mjs";

const SEED = join(ROOT, "tools/seed/era-areas.json");

/** @returns {Promise<{build: string, keys: Set<string>}>} */
export async function loadEraAreas() {
  const seed = await readJson(SEED);
  return { build: seed.build, keys: new Set(seed.names.map(normaliseKey)) };
}
