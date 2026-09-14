"use client";

import AudioPlayer from "@/components/AudioPlayer";
import { BASE_LANG, type Lang } from "@/lib/zones/lang";
import type { ResultLine } from "@/lib/zones/search";

/**
 * The zones section's half of the player: which clip a line plays, and what to call it.
 *
 * Everything else - the transport, the scrubber, the keyboard element - is AudioPlayer,
 * shared with quests.
 */
type Props = {
  line: ResultLine | null;
  /** Take version, used only to bust the browser cache after a regeneration. */
  version?: number;
  /** Which language's narration to fetch. The file path itself carries none. */
  lang?: Lang;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function Player({ line, version, lang = BASE_LANG, audioRef }: Props) {
  const query = new URLSearchParams();
  if (version !== undefined) query.set("v", String(version));
  if (lang !== BASE_LANG) query.set("lang", lang);

  // A line with no take has nothing to play, and passing a src that 404s would leave the
  // transport enabled over silence.
  const playable = line !== null && line.state !== "missing";

  return (
    <AudioPlayer
      audioRef={audioRef}
      src={
        playable ? `/api/zones/audio/${line.file}.mp3${query.size ? `?${query}` : ""}` : undefined
      }
      title={line?.name ?? null}
      meta={line?.id}
      subtitle={line?.text}
      downloadName={line ? `${line.file.replace(/\//g, "-")}.mp3` : undefined}
      // Zones records the duration on the take, so the total is known before the file loads.
      totalHint={line?.take?.durationSec ?? undefined}
    />
  );
}
