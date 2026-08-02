// The bridge to tools/voice/*.mjs.
//
// Every import that crosses out of web/ goes through this one file, so the blast
// radius of the boundary is one module rather than scattered `../../../tools/...`
// specifiers. next.config.ts sets outputFileTracingRoot to the repo root, without
// which Next traces dependencies from web/ alone and leaves all of this out of the
// build.
//
// WHY IMPORT RATHER THAN SHELL OUT. Spawning `node tools/voice/generate.mjs` would
// have kept the boundary clean and cost the two things that matter: the typed failure
// kinds from elevenlabs.mjs (quota vs auth vs rate-limit, which decide whether the
// rest of a batch is worth attempting) and the character-cost header, which is the
// only authoritative record of what a line was billed. Parsing those back out of
// stdout is how the CLI and the app start disagreeing.
//
// These modules are dependency-free ESM with no build step. TypeScript reads them
// with allowJs and infers their shapes; the `as` casts below are the one place those
// inferred shapes are pinned to what this app relies on, so a change in tools/ shows
// up as a type error here rather than as undefined at runtime.

import * as generateModule from "../../../tools/voice/generate.mjs";
import * as storeModule from "../../../tools/voice/store.mjs";
import * as normaliseModule from "../../../tools/voice/normalise.mjs";
import * as namingModule from "../../../tools/voice/naming.mjs";

/** One voiceable entry: a zone, or a subzone of one. Mirrors buildCatalogue(). */
export type CatalogueEntry = {
  /** 'z:1411' | 's:1411:razor hill'. tools/voice/naming.mjs owns the format. */
  id: string;
  kind: "zone" | "subzone";
  mapID: number;
  /** The canonical subzone key, or null for a zone line. */
  key: string | null;
  /** Display name. Subzones carry it in `name`, zones too. */
  name: string;
  zoneName: string;
  /** The prose shown in-game. */
  full: string;
  /** Where the lore came from. */
  source?: string;
  /** What is actually sent to ElevenLabs: brackets stripped, rules applied. */
  spoken: string;
  /** sha1 of `spoken`. Compared against a take's textHash to detect staleness. */
  hash: string;
  /** Store-relative and extension-less, e.g. '1411/razor-hill'. */
  file: string;
};

/** What generation recorded for a line. Mirrors a manifest record / a current take. */
export type TakeRecord = {
  file: string;
  textHash: string;
  chars: number;
  credits: number | null;
  durationSec: number | null;
  bytes: number;
  voiceId: string | null;
  modelId: string | null;
  outputFormat: string | null;
  dictionaryId: string | null;
  dictionaryVersionId: string | null;
  generatedAt: string;
};

export type Manifest = Record<string, TakeRecord>;

export const buildCatalogue = generateModule.buildCatalogue as () => Promise<CatalogueEntry[]>;

export const measureRates = generateModule.measureRates as (
  manifest: Manifest,
  config: { creditRate?: number | null } | null,
) => { creditRate: number | null; charsPerSecond: number; measuredFrom: number };

export const loadManifest = storeModule.loadManifest as () => Promise<Manifest>;
export const SOUNDS_DIR = storeModule.SOUNDS_DIR as string;
export const HISTORY_DIR = storeModule.HISTORY_DIR as string;

export const toSpokenText = normaliseModule.toSpokenText as (
  text: string,
  rules: Record<string, string>,
) => string;
export const loadPronunciation = normaliseModule.loadPronunciation as () => Promise<
  Record<string, string>
>;
export const PRONUNCIATION_PATH = normaliseModule.PRONUNCIATION_PATH as string;

export const textHash = namingModule.textHash as (spoken: string) => string;
