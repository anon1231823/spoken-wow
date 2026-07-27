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
    <div className="bg-card fixed inset-x-0 bottom-0 border-t px-5 py-2.5">
      <div className="mx-auto flex max-w-4xl items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {line ? `${line.npcName} · ${line.lineId}` : "Nothing playing"}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {line ? line.text : "Pick a line to hear it."}
          </div>
        </div>
        <audio
          ref={ref}
          controls
          preload="none"
          className="w-[320px] max-w-[45%] shrink-0"
          src={line ? `/api/audio/${line.audioPath}` : undefined}
        />
      </div>
    </div>
  );
});

export default Player;
