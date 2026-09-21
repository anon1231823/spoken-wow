/**
 * Where a book page's archived takes live.
 *
 * Writing a take -- archiving the one it replaces, recording the row, updating the store --
 * is lib/takes/commit.ts, shared by all three sections. What is left here is the one fact
 * about books that the take layer cannot know by itself: where its history directory is.
 */
import "server-only";

import { soundsDir } from "./audio";

/** Previous takes, one directory per file, beside the live store. */
export function historyDir(): string {
  return process.env.SPOKEN_BOOKS_AUDIO_HISTORY ?? `${soundsDir()}-history`;
}
