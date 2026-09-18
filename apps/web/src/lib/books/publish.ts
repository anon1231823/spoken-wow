/**
 * Getting a finished take into the addon.
 *
 * The addon resolves every clip through Data/Sounds.lua, so a take that is not in it is
 * unreachable and a stale duration resets the Play button at the wrong moment. This is the
 * books half of what lib/zones/regenerate.ts's `publish` does for zone lore.
 *
 * Called once when the queue drains rather than per line: the lookup rewrites the whole
 * table, and doing that per take would be the slowest part of a run otherwise spent waiting
 * on ElevenLabs. The single-page route calls it directly, because one page has no drain to
 * wait for -- and leaving it unpublished until the next batch would make one-off
 * regeneration the one path whose result the addon cannot play.
 */
import "server-only";

import * as lookupModule from "@books-tools/lib/lookup.mjs";

const buildLookup = lookupModule.buildLookup as (options?: {
  lang?: string;
  out?: string;
}) => Promise<{ clips: number; path: string }>;

export async function publish(): Promise<void> {
  await buildLookup();
}
