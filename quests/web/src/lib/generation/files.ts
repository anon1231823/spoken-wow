/**
 * Reading voice/generation.json and voice/pronunciation.json off disk.
 *
 * Kept apart from config.ts so the settings form can import the shapes without dragging
 * node:fs into the browser bundle. Both ship inside the release, so they cannot change under
 * a running server without a deploy - which replaces the process - and are therefore read
 * once and memoised.
 *
 * voice/lexicon.json is deliberately absent from this list. The lexicon lives in the
 * pronunciation_lexicon row, seeded once by migration 0008 and edited from the web UI after
 * that; the file is provenance and the input to tools/build_lexicon.py. Reading it here
 * would put a stale snapshot back in competition with the live data.
 */
import fs from "node:fs";
import path from "node:path";

import { VOICE_CONFIG_DIR } from "@/lib/paths";

import { FALLBACK, fromFileShape, type GenerationConfig } from "./config";

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

export type FileDefaults = {
  config: GenerationConfig;
  rules: Record<string, string>;
};

const defaultsKey = Symbol.for("wow-voiceover.generation-defaults");
type Holder = { [defaultsKey]?: FileDefaults };

export function fileDefaults(): FileDefaults {
  const holder = globalThis as Holder;
  if (!holder[defaultsKey]) {
    holder[defaultsKey] = {
      config: readGenerationFile(),
      rules: readPronunciationFile(),
    };
  }
  return holder[defaultsKey]!;
}
