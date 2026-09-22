/**
 * The bridge to pipelines/books/tools.
 *
 * One module for the whole boundary, as lib/zones/tools.ts is for the zones pipeline, and
 * for the same reason: `../../../../pipelines/...` scattered through the app is a boundary
 * nobody can see. next.config.ts's outputFileTracingRoot is what puts these files in the
 * build at all.
 *
 * WHY IMPORT RATHER THAN REIMPLEMENT. The spoken text and its hash decide what ElevenLabs
 * is sent and whether a take is stale. Written twice -- once in Lua-facing JavaScript and
 * once in TypeScript here -- they drift, and the drift shows up as audio the explorer calls
 * current and the addon never plays.
 */
import "server-only";

import * as textModule from "@books-tools/lib/text.mjs";
import * as namingModule from "@books-tools/lib/naming.mjs";

/** What would be sent to a narrator: markup gone, paragraphs flattened. */
export const spokenText = textModule.spokenText as (text: string) => string;

/**
 * Whether a page's text can be voiced, and if not why: empty, a placeholder, or a `$N`-style
 * token the game fills in at runtime and a recording cannot. The extract's own rule, so a
 * page written on the site is judged exactly as one read out of vmangos.
 */
export const isGeneratable = textModule.isGeneratable as (text: string) => {
  generatable: boolean;
  skipReason: string | null;
};

/** sha1 of the spoken text. Compared against a take's hash to spot stale audio. */
export const textHash = namingModule.textHash as (text: string) => string;

/** Store-relative and extension-less, e.g. '1381'. AGENTS.md freezes it. */
export const fileFor = namingModule.fileFor as (pageId: number) => string;

/** The checksum the addon recomputes in Lua to tell two same-named books apart. */
export const pageChecksum = namingModule.pageChecksum as (text: string) => number;

