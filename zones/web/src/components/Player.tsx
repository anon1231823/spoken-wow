"use client";

import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ResultLine } from "@/lib/search";
import { cn, timecode } from "@/lib/utils";

// ONE <audio> FOR THE WHOLE PAGE. Starting a line therefore stops the previous one
// with no cross-row bookkeeping at all -- the alternative, an element per row, means
// tracking which are playing and pausing them by hand, and getting it wrong sounds
// like two narrators talking over each other.
//
// The element is handed back up to Explorer through `audioRef` because playback is
// driven imperatively from the keyboard (space, j, k), which is not something React
// state can express.

const RATES = [0.75, 1, 1.25, 1.5, 2];

type Props = {
  line: ResultLine | null;
  /** Take version, used only to bust the browser cache after a regeneration. */
  version?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export function Player({ line, version, audioRef }: Props) {
  const local = useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  // While dragging, the slider follows the pointer instead of timeupdate. Without
  // this the thumb fights the playhead and snaps back every 250ms.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    const el = local.current;
    if (!el) return;

    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onRate = () => setRate(el.playbackRate);
    const onVolume = () => setMuted(el.muted);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("ratechange", onRate);
    el.addEventListener("volumechange", onVolume);

    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("ratechange", onRate);
      el.removeEventListener("volumechange", onVolume);
    };
  }, []);

  // A new line starts at zero even before its metadata arrives, so the previous
  // clip's duration is never briefly shown against the new one's name.
  useEffect(() => {
    setTime(0);
    setDuration(0);
  }, [line?.id]);

  const attach = (el: HTMLAudioElement | null) => {
    local.current = el;
    audioRef.current = el;
  };

  const src = line
    ? `/api/audio/${line.file}.mp3${version === undefined ? "" : `?v=${version}`}`
    : undefined;

  const position = scrubbing ?? time;
  const hasAudio = line !== null && line.state !== "missing";
  // The recorded duration is known before the file loads, so the total shows
  // immediately rather than after the first byte arrives.
  const total = duration || line?.take?.durationSec || 0;

  return (
    <div className="border-t border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!hasAudio}
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            const el = local.current;
            if (!el) return;
            if (el.paused) void el.play().catch(() => {});
            else el.pause();
          }}
          className="rounded p-1.5 hover:bg-panel-hover disabled:opacity-30"
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate font-medium">{line ? line.name : "Nothing playing"}</span>
            {line && line.kind === "subzone" && (
              <span className="truncate text-xs text-faint">{line.zoneName}</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">
              {timecode(position)}
            </span>
            <input
              type="range"
              min={0}
              max={total || 1}
              step={0.05}
              value={position}
              disabled={!hasAudio || !total}
              aria-label="Seek"
              onChange={(event) => setScrubbing(Number(event.target.value))}
              // Commit on release, not on every intermediate value: setting
              // currentTime per pointer move restarts the fetch each time.
              onMouseUp={commit}
              onTouchEnd={commit}
              onKeyUp={commit}
            />
            <span className="w-10 shrink-0 font-mono text-xs text-muted">{timecode(total)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => local.current && (local.current.muted = !local.current.muted)}
          aria-label={muted ? "Unmute" : "Mute"}
          className="rounded p-1.5 hover:bg-panel-hover"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>

        <button
          type="button"
          onClick={() => {
            const el = local.current;
            if (!el) return;
            el.playbackRate = RATES[(RATES.indexOf(el.playbackRate) + 1) % RATES.length] ?? 1;
          }}
          className="w-12 rounded px-1 py-1 font-mono text-xs hover:bg-panel-hover"
          title="Playback speed"
        >
          {rate}&times;
        </button>

        {src && (
          <a
            href={src}
            download={`${line!.file.replace(/\//g, "-")}.mp3`}
            className={cn("rounded p-1.5 hover:bg-panel-hover", !hasAudio && "pointer-events-none opacity-30")}
            aria-label="Download"
          >
            <Download size={16} />
          </a>
        )}
      </div>

      <audio ref={attach} src={src} preload="metadata" />
    </div>
  );

  function commit() {
    if (scrubbing === null) return;
    if (local.current) local.current.currentTime = scrubbing;
    setTime(scrubbing);
    setScrubbing(null);
  }
}
