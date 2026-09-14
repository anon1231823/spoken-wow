"use client";

import AudioPlayer from "@/components/AudioPlayer";
import type { ResultLine } from "@/lib/search";

/**
 * The quests section's half of the player: which file a line plays, and what to call it.
 *
 * Everything else - the transport, the scrubber, the keyboard element - is AudioPlayer,
 * shared with zones.
 */

/**
 * What the file should be called once it leaves the store.
 *
 * The store path flattened rather than its basename, because the subfolder is part of the
 * identity: quests/ and gossip/ are separate namespaces, and a downloads folder is not.
 */
function downloadName(line: ResultLine): string {
  return line.audioPath.replace("/", "-");
}

type Props = {
  line: ResultLine | null;
  /**
   * The take currently in the store, when this line has been regenerated in this session.
   *
   * Appended to the audio URL as a cache buster. Replacing a line does not change its path -
   * the addon resolves sounds by filename, so it cannot - and /api/quests/audio answers with
   * a weak ETag that a cached response need not revalidate, so without this the browser
   * replays the take that was just overwritten.
   */
  version?: number;
  ref: React.RefObject<HTMLAudioElement | null>;
};

export default function Player({ line, version, ref }: Props) {
  return (
    <AudioPlayer
      audioRef={ref}
      src={
        line
          ? `/api/quests/audio/${line.audioPath}${version === undefined ? "" : `?v=${version}`}`
          : undefined
      }
      title={line?.npcName ?? null}
      meta={line?.lineId}
      subtitle={line?.text}
      downloadName={line ? downloadName(line) : undefined}
    />
  );
}
