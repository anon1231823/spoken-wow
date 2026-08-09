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
import * as elevenModule from "../../../tools/voice/elevenlabs.mjs";
import * as concurrencyModule from "../../../tools/voice/concurrency.mjs";
import * as exportModule from "../../../tools/voice/export-manifest.mjs";
import * as lookupModule from "../../../tools/voice/build-lookup.mjs";
import * as wikiModule from "../../../tools/lib/wiki.mjs";

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

export const textHash = namingModule.textHash as (spoken: string) => string;

// The summary shown in list views, derived from the full text. Shared with the scrapers
// rather than reimplemented here, so a line edited in the explorer and a line scraped
// from the wiki get the same summary from the same prose.
export const makeShort = wikiModule.makeShort as (full: string, limit?: number) => string;

//------------------------------------------------------------------------------
// Generation
//------------------------------------------------------------------------------

/** tools/voice/config.json. Written back when a voice or dictionary is resolved. */
export type VoiceConfig = {
  voiceName: string;
  voiceId?: string;
  modelId: string;
  languageCode?: string;
  outputFormat: string;
  dictionaryId?: string | null;
  dictionaryVersionId?: string | null;
  creditRate?: number | null;
  voiceSettings: Record<string, number | boolean>;
};

export const loadConfig = elevenModule.loadConfig as () => Promise<VoiceConfig>;
export const saveConfig = elevenModule.saveConfig as (config: VoiceConfig) => Promise<void>;
export const apiKey = elevenModule.apiKey as () => Promise<string>;

/** Every voice on the account, as ElevenLabs returns them. */
export const listVoices = elevenModule.listVoices as (
  key: string,
) => Promise<Array<{ voice_id: string; name: string; category: string }>>;
export const resolveVoiceId = elevenModule.resolveVoiceId as (
  config: VoiceConfig,
  key: string,
) => Promise<string>;
export const resolveDictionary = elevenModule.resolveDictionary as (
  config: VoiceConfig,
  key: string,
) => Promise<void>;
export const fetchTier = elevenModule.fetchTier as (key: string) => Promise<string | null>;

/** Throws on a non-retryable failure; retries 429 and 5xx internally. */
export const synthesize = elevenModule.synthesize as (
  spoken: string,
  config: VoiceConfig,
  key: string,
  options?: { attempts?: number; onRateLimit?: () => void },
) => Promise<{ audio: Buffer; credits: number | null }>;

export const budgetFor = concurrencyModule.budgetFor as (
  tier: string | null,
  modelId: string,
) => number;

type LimiterCtor = new (limit: number) => {
  run<T>(task: () => Promise<T>): Promise<T>;
  setLimit(limit: number): void;
};
export const Limiter = concurrencyModule.Limiter as LimiterCtor;
export const afterRateLimit = concurrencyModule.afterRateLimit as (
  budget: number,
  at: number,
  now: number,
) => number;
export const COOL_DOWN_MS = concurrencyModule.COOL_DOWN_MS as number;

/** Archives the take being replaced, then writes. Returns the absolute path. */
export const writeAudio = storeModule.writeAudio as (
  file: string,
  buffer: Buffer,
) => Promise<string>;
export const durationOf = storeModule.durationOf as (path: string) => Promise<number>;
export const insertTake = storeModule.insertTake as (
  lineId: string,
  record: TakeRecord,
  origin: "imported" | "generated",
  settings?: Record<string, unknown> | null,
) => Promise<number>;
export const restoreTake = storeModule.restoreTake as (
  file: string,
  archiveVersion: number,
) => Promise<string>;

export const exportManifest = exportModule.exportManifest as (options?: {
  check?: boolean;
}) => Promise<{ skipped: boolean; changed: boolean; count: number }>;
export const buildLookup = lookupModule.buildLookup as () => Promise<{
  zones: number;
  subzones: number;
  missingFiles: number;
}>;
