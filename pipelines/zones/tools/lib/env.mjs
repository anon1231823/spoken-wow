// Reading credentials out of .env.
//
// A short reader rather than a dependency, matching this repo's other tools, which
// have none. The file wins over the ambient environment on purpose: a key exported
// for another project is exactly the mix-up ../wow-voiceover/tts_cli/env_vars.py
// documents having been bitten by.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "./loredata.mjs";

export const ENV_PATH = join(ROOT, ".env");

/**
 * Copy .env into process.env for keys that are not already set.
 *
 * .env.example has always documented DATABASE_URL as belonging in .env, but the
 * database layer reads process.env and nothing bridged the two, so the documented
 * setup silently did nothing and every database target needed the variable exported
 * by hand. This is the bridge.
 *
 * Call it from a CLI entry point, never from a module the explorer bundles: paths
 * here derive from ROOT, which webpack resolves to the build machine's filesystem.
 * An already-set variable always wins, so an explicit `DATABASE_URL= make ...`
 * still means "use the files".
 */
export async function loadEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of (await readFile(ENV_PATH, "utf8")).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, name, raw] = match;
    if (process.env[name] !== undefined) continue;
    const value = raw.trim().replace(/^["']|["']$/g, "");
    if (value) process.env[name] = value;
  }
}

/** The named key from .env, else the environment, else null. */
export async function readEnvKey(name) {
  if (existsSync(ENV_PATH)) {
    const pattern = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`);
    for (const line of (await readFile(ENV_PATH, "utf8")).split("\n")) {
      const match = line.match(pattern);
      if (match) {
        const value = match[1].trim().replace(/^["']|["']$/g, "");
        if (value) return value;
      }
    }
  }
  return process.env[name] || null;
}

/** The named key, or an error naming the file it belongs in. */
export async function requireEnvKey(name, example) {
  const value = await readEnvKey(name);
  if (value) return value;
  throw new Error(
    `no ${name}.\n` +
      `  Put it in ${ENV_PATH} as:  ${name}=${example}\n` +
      "  (.env is gitignored.)",
  );
}
