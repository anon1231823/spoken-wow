/**
 * The three things the take layer cannot write once: where a section keeps its audio.
 *
 * Everything else about a take is the same in all three -- one table, one archive rule, one
 * history panel -- but the paths and the file naming are frozen by AGENTS.md and differ on
 * purpose. A quests file carries its extension and is shared by several NPCs
 * ('gossip/31ab….mp3'); a zones or books file is extension-less and belongs to one line
 * ('1411/razor-hill'). Renaming either means re-shipping a sound pack every user has
 * already downloaded.
 *
 * A total Record rather than a switch, for the reason lib/generation/worker.ts:122 gives:
 * adding a section and forgetting one of these is then a type error rather than a route
 * that resolves to the wrong directory.
 */
import "server-only";

import path from "node:path";

import { AUDIO_DIR, AUDIO_HISTORY_DIR } from "@/lib/paths";
import type { Source } from "@/lib/generation/queue";
import { soundsDir as booksSounds } from "@/lib/books/audio";
import { historyDir as booksHistory } from "@/lib/books/store";
import { historyDir as zonesHistory, soundsDir as zonesSounds } from "@/lib/zones/tools";

export type StoreAdapter = {
  /** Where one line's archived takes live. */
  historyDir: (file: string) => string;
  /** Where the live clip lives. */
  storePath: (file: string) => string;
};

export const ADAPTERS: Record<Source, StoreAdapter> = {
  // The history mirrors the store one level deeper, so a take is addressable by path
  // alone: audio-history/gossip/31ab…/0.mp3 beside audio/gossip/31ab….mp3.
  quests: {
    historyDir: (file) =>
      path.join(AUDIO_HISTORY_DIR, path.dirname(file), path.basename(file, ".mp3")),
    storePath: (file) => path.join(AUDIO_DIR, file),
  },
  // A sibling of Sounds/ rather than a child, because validate-audio.mjs walks Sounds/ and
  // would otherwise flag every archived take as a clip the lookup table does not know.
  zones: {
    historyDir: (file) => path.join(zonesHistory(), file),
    storePath: (file) => path.join(zonesSounds(), `${file}.mp3`),
  },
  books: {
    historyDir: (file) => path.join(booksHistory(), file),
    storePath: (file) => path.join(booksSounds(), `${file}.mp3`),
  },
};

export function historyDirOf(source: Source, file: string): string {
  return ADAPTERS[source].historyDir(file);
}

export function storePathOf(source: Source, file: string): string {
  return ADAPTERS[source].storePath(file);
}
