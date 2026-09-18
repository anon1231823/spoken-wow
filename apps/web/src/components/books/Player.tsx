"use client";

import AudioPlayer from "@/components/AudioPlayer";
import type { ResultLine } from "@/lib/books/search";

/**
 * The books section's half of the player: which clip a page plays, and what to call it.
 *
 * Everything else -- the transport, the scrubber, the keyboard element -- is AudioPlayer,
 * shared with quests and zones.
 */
type Props = {
  line: ResultLine | null;
  /** Take version, used only to bust the browser cache after a regeneration. */
  version?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function Player({ line, version, audioRef }: Props) {
  const query = new URLSearchParams();
  if (version !== undefined) query.set("v", String(version));

  // A page with no take has nothing to play, and passing a src that 404s would leave the
  // transport enabled over silence.
  const playable = line !== null && line.state !== "missing";

  return (
    <AudioPlayer
      audioRef={audioRef}
      src={
        playable ? `/api/books/audio/${line.file}.mp3${query.size ? `?${query}` : ""}` : undefined
      }
      title={
        line === null
          ? null
          : line.pageCount > 1
            ? `${line.title} · page ${line.pageNumber} of ${line.pageCount}`
            : line.title
      }
      meta={line?.id}
      subtitle={line?.text}
      downloadName={line ? `${line.title.replace(/\W+/g, "-").toLowerCase()}-${line.pageId}.mp3` : undefined}
      // Books records the duration on the take, so the total is known before the file loads.
      totalHint={line?.take?.durationSec ?? undefined}
    />
  );
}
