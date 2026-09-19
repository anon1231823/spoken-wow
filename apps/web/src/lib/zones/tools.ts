/**
 * The bridge to pipelines/zones/tools.
 *
 * Every import that crosses out of this app goes through this one file, so the blast radius
 * of the boundary is one module rather than scattered `../../../../pipelines/...` specifiers.
 * next.config.ts sets outputFileTracingRoot to the repo root, without which Next traces
 * dependencies from apps/web alone and leaves all of this out of the build.
 *
 * WHY IMPORT RATHER THAN SHELL OUT. Spawning `node tools/voice/generate.mjs` would have kept
 * the boundary clean and cost the two things that matter: the typed failure kinds from
 * elevenlabs.mjs (quota vs auth vs rate-limit, which decide whether the rest of a batch is
 * worth attempting) and the character-cost header, which is the only authoritative record of
 * what a line was billed. Parsing those back out of stdout is how the CLI and the app start
 * disagreeing.
 *
 * These modules are dependency-free ESM with no build step. TypeScript reads them with
 * allowJs and infers their shapes; the `as` casts below are the one place those inferred
 * shapes are pinned to what this app relies on, so a change in pipelines/zones shows up as a
 * type error here rather than as undefined at runtime.
 *
 * WHAT IS DELIBERATELY NOT HERE, and was on the zones site:
 *
 *   loadConfig / saveConfig / draftConfig / resolveVoiceId
 *     The narrator's voice, model and settings came from tools/voice/config.json. They come
 *     from the database now, shared with the quests side: the roster on /voices, the model
 *     and voice settings from generation_setting, the dictionary from pronunciation_lexicon.
 *     config.json is down to a fallback credit rate for the reporting CLI.
 *
 *   verifyKey / fetchTier / listVoices / apiKey
 *     The account is read through lib/voices/elevenlabs.ts, which both sections share, and a
 *     key belongs to the signed-in user rather than to the machine.
 *
 *   Limiter / afterRateLimit / budgetFor's caller
 *     Concurrency is the shared queue's, in lib/generation/concurrency.ts. Two answers to
 *     "how many at once" against one ElevenLabs plan is one too many.
 */
import "server-only";

import * as storeModule from "@tools/voice/store.mjs";
import * as normaliseModule from "@tools/voice/normalise.mjs";
import * as namingModule from "@tools/voice/naming.mjs";
import * as elevenModule from "@tools/voice/elevenlabs.mjs";
import * as exportModule from "@tools/voice/export-manifest.mjs";
import * as lookupModule from "@tools/voice/build-lookup.mjs";
import * as wikiModule from "@tools/lib/wiki.mjs";

/** What generation recorded for a line. Mirrors a manifest record, and so a current take. */
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

// buildCatalogue() is deliberately NOT re-exported. It reads the committed Lua, which is an
// export of lore_line and therefore at best as fresh as the table; the app builds its
// catalogue from the table itself. The CLI keeps it: tools/ must run without a database.

/** Assigns every entry its audio path, resolving slug collisions. Returns lineId -> file. */
export const assignFiles = namingModule.assignFiles as (
  entries: Array<{ mapID: number; key: string | null }>,
) => Map<string, string>;

export const textHash = namingModule.textHash as (spoken: string) => string;

// Functions rather than constants: each reads an environment override the droplet sets,
// and a path resolved at import would be fixed before the process had one.
export const soundsDir = storeModule.soundsDir as () => string;
export const historyDir = storeModule.historyDir as () => string;

export const toSpokenText = normaliseModule.toSpokenText as (
  text: string,
  rules: Record<string, string>,
) => string;
export const loadPronunciation = normaliseModule.loadPronunciation as () => Promise<
  Record<string, string>
>;

// The summary shown in list views, derived from the full text. Shared with the scrapers
// rather than reimplemented here, so a line edited in the explorer and a line scraped from
// the wiki get the same summary from the same prose.
export const makeShort = wikiModule.makeShort as (full: string, limit?: number) => string;

/**
 * What synthesize() needs to know, assembled per request rather than read from a file.
 *
 * The same shape tools/voice/config.json has, because the CLI still reads that file and both
 * paths must produce identical audio - but every field is resolved from the database here.
 * See lib/zones/voice.ts for where each one comes from.
 */
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

/** Throws on a non-retryable failure; retries 429 and 5xx internally. */
export const synthesize = elevenModule.synthesize as (
  spoken: string,
  config: VoiceConfig,
  key: string,
  options?: { attempts?: number; onRateLimit?: () => void },
) => Promise<{ audio: Buffer; credits: number | null }>;

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

// What the addon actually ships, rebuilt after a batch drains rather than after every line:
// buildLookup rewrites the whole table, and doing that 1,353 times would be the slowest part
// of a run that is otherwise waiting on ElevenLabs.
export const exportManifest = exportModule.exportManifest as (options?: {
  check?: boolean;
}) => Promise<{ skipped: boolean; changed: boolean; count: number }>;
export const buildLookup = lookupModule.buildLookup as () => Promise<{
  zones: number;
  subzones: number;
  missingFiles: number;
  path: string;
}>;
