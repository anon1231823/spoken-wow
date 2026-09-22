/**
 * Where each section archives its takes: the one thing the take layer cannot write once.
 *
 * Everything else about a take is the same in all three -- one table, one commit, one
 * history panel -- but the paths are frozen by AGENTS.md and differ on purpose. A quests
 * file carries its extension and is shared by several NPCs ('gossip/31ab….mp3'); a zones or
 * books file is extension-less and belongs to one line ('1411/razor-hill'). Renaming either
 * means re-shipping a sound pack every user has already downloaded.
 *
 * Every take of a file lives in one directory named after the file, one level deeper than
 * the addon's own path: gossip/31ab….mp3 is archived under audio-history/gossip/31ab…/.
 * What a take's archived file is called is its row's business (`archiveFile`); this only
 * says which directory it is in. There is no live copy anywhere else: the live take is a
 * flag on its row, and a pack build copies it to the addon's path (scripts/audio/sounds.mjs).
 *
 * A total Record rather than a switch, for the reason lib/generation/worker.ts gives:
 * adding a section and forgetting one of these is then a type error rather than a route
 * that resolves to the wrong directory.
 */
import "server-only";

import path from "node:path";

import { historyDir as booksHistory } from "@/lib/books/audio";
import { AUDIO_HISTORY_DIR } from "@/lib/paths";
import { isSafeAudioPath } from "@/lib/range";
import type { Source } from "@/lib/sections";
import { historyDir as zonesHistory } from "@/lib/zones/tools";

type StoreAdapter = {
  /** Where one line's archived takes live. */
  historyDir: (file: string) => string;
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
  },
  zones: {
    historyDir: (file) => path.join(zonesHistory(), file),
  },
  books: {
    historyDir: (file) => path.join(booksHistory(), file),
  },
};

export function historyDirOf(source: Source, file: string): string {
  return ADAPTERS[source].historyDir(file);
}
