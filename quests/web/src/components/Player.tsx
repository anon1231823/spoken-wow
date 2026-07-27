"use client";

import { forwardRef } from "react";

import type { ResultLine } from "@/lib/search";

type Props = { line: ResultLine | null };

/**
 * One shared <audio> element for the whole page, so starting a line stops the previous
 * one without any bookkeeping across rows.
 */
const Player = forwardRef<HTMLAudioElement, Props>(function Player({ line }, ref) {
  return (
    <div className="player">
      <div className="player-inner">
        <div className="player-meta">
          <div className="player-title">
            {line ? `${line.npcName} · ${line.lineId}` : "Nothing playing"}
          </div>
          <div className="player-text">
            {line ? line.text : "Pick a line to hear it."}
          </div>
        </div>
        <audio
          ref={ref}
          controls
          preload="none"
          src={line ? `/api/audio/${line.audioPath}` : undefined}
        />
      </div>
    </div>
  );
});

export default Player;
