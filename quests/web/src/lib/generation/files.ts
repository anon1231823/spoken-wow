/**
 * Reading voice/generation.json, voice/pronunciation.json and voice/lexicon.json off disk.
 *
 * Kept apart from config.ts and lexicon.ts so the settings form and the lexicon editor can
 * import the shapes without dragging node:fs into the browser bundle. All three ship inside
 * the release, so they cannot change under a running server without a deploy - which
 * replaces the process - and are therefore read once and memoised.
 */
import fs from "node:fs";
import path from "node:path";

import { VOICE_CONFIG_DIR } from "@/lib/paths";

import { FALLBACK, fromFileShape, type GenerationConfig } from "./config";
import { validateEntry, type LexiconEntry } from "./lexicon";

export function generationPath(dir: string = VOICE_CONFIG_DIR): string {
  return path.join(dir, "generation.json");
}

export function pronunciationPath(dir: string = VOICE_CONFIG_DIR): string {
  return path.join(dir, "pronunciation.json");
}

export function readGenerationFile(dir: string = VOICE_CONFIG_DIR): GenerationConfig {
  try {
    return fromFileShape(JSON.parse(fs.readFileSync(generationPath(dir), "utf8")));
  } catch (error) {
    console.warn(`could not read ${generationPath(dir)}, using built-in defaults:`, error);
    return FALLBACK;
  }
}

/**
 * Pronunciation rules: regex source -> replacement.
 *
 * Absent or unreadable means no rules. There is no built-in fallback because losing them
 * only costs pronunciation quality, whereas inlining a copy of data the Python side owns
 * would be a second place for it to drift.
 */
export function readPronunciationFile(dir: string = VOICE_CONFIG_DIR): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(pronunciationPath(dir), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).filter(
        ([, value]) => typeof value === "string",
      ) as [string, string][],
    );
  } catch (error) {
    console.warn(`could not read ${pronunciationPath(dir)}, no rules applied:`, error);
    return {};
  }
}

export function lexiconPath(dir: string = VOICE_CONFIG_DIR): string {
  return path.join(dir, "lexicon.json");
}

/**
 * The committed pronunciation lexicon.
 *
 * Absent or unreadable means an empty lexicon, matching readPronunciationFile: a missing
 * file costs pronunciation quality, whereas a built-in fallback copy would be a second
 * place for 134 entries to drift from the ones tools/build_lexicon.py generates the PLS from.
 *
 * Individually invalid entries are dropped with a warning rather than taking the file down
 * with them. One malformed entry hand-edited into lexicon.json should cost that one name,
 * not every name - and the editor shows the count, so a silent loss is still a visible one.
 */
export function readLexiconFile(dir: string = VOICE_CONFIG_DIR): LexiconEntry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(lexiconPath(dir), "utf8"));
  } catch (error) {
    console.warn(`could not read ${lexiconPath(dir)}, no lexicon applied:`, error);
    return [];
  }

  const entries = (raw as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) {
    console.warn(`${lexiconPath(dir)} has no "entries" array, no lexicon applied`);
    return [];
  }

  const kept: LexiconEntry[] = [];
  for (const [index, entry] of entries.entries()) {
    try {
      kept.push(validateEntry(entry, index));
    } catch (error) {
      console.warn(`skipping ${lexiconPath(dir)} entry ${index}:`, error);
    }
  }
  return kept;
}

export type FileDefaults = {
  config: GenerationConfig;
  rules: Record<string, string>;
  lexicon: LexiconEntry[];
};

const defaultsKey = Symbol.for("wow-voiceover.generation-defaults");
type Holder = { [defaultsKey]?: FileDefaults };

export function fileDefaults(): FileDefaults {
  const holder = globalThis as Holder;
  if (!holder[defaultsKey]) {
    holder[defaultsKey] = {
      config: readGenerationFile(),
      rules: readPronunciationFile(),
      lexicon: readLexiconFile(),
    };
  }
  return holder[defaultsKey]!;
}
