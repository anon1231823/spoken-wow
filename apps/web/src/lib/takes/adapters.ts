/**
 * Where each section keeps its audio: the one thing the take layer cannot write once.
 *
 * Everything else about a take is the same in all three -- one table, one commit, one
 * history panel -- but the paths are frozen by AGENTS.md and differ on purpose. A quests
 * file carries its extension and is shared by several NPCs ('gossip/31ab….mp3'); a zones or
 * books file is extension-less and belongs to one line ('1411/razor-hill'). Renaming either
 * means re-shipping a sound pack every user has already downloaded.
 *
 * Each section's archive mirrors its store one level deeper, so a take is addressable by
 * path alone: audio-history/gossip/31ab…/v3-1a2b3c4d.mp3 beside audio/gossip/31ab….mp3.
 * What a take's archived file is called is its row's business (`archiveFile`); this only
 * says which directory it is in.
 *
 * A total Record rather than a switch, for the reason lib/generation/worker.ts gives:
 * adding a section and forgetting one of these is then a type error rather than a route
 * that resolves to the wrong directory.
 */
import "server-only";

import path from "node:path";

import { historyDir as booksHistory, soundsDir as booksSounds } from "@/lib/books/audio";
import { AUDIO_DIR, AUDIO_HISTORY_DIR } from "@/lib/paths";
import { isSafeAudioPath } from "@/lib/range";
import type { Source } from "@/lib/sections";
import { historyDir as zonesHistory, soundsDir as zonesSounds } from "@/lib/zones/tools";

type StoreAdapter = {
  /** Where one line's archived takes live. */
  historyDir: (file: string) => string;
  /** Where the live clip lives. */
  storePath: (file: string) => string;
};

/**
 * Quests paths come from a request body more directly than the other two, and are checked
 * against a whitelist pattern -- not sanitised -- the same one /api/quests/audio uses.
 */
function questsFile(file: string): string {
  if (!isSafeAudioPath(file)) throw new Error(`unsafe store path ${file}`);
  return file;
}

const ADAPTERS: Record<Source, StoreAdapter> = {
  quests: {
    historyDir: (file) =>
      path.join(AUDIO_HISTORY_DIR, path.dirname(questsFile(file)), path.basename(file, ".mp3")),
    storePath: (file) => path.join(AUDIO_DIR, questsFile(file)),
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
