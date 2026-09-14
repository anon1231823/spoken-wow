"use client";

import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { timecode } from "@/lib/utils";

/**
 * The transport bar both sections play through.
 *
 * ONE <audio> FOR THE WHOLE PAGE. Starting a line therefore stops the previous one with no
 * bookkeeping across rows -- the alternative, an element per row, means tracking which are
 * playing and pausing them by hand, and getting that wrong sounds like two narrators talking
 * over each other.
 *
 * The element stays a plain <audio> handed back through `audioRef`, because both explorers
 * drive playback imperatively from the keyboard (space toggles, j/k step). The chrome here is
 * presentation over that element, never a replacement for it.
 *
 * WHAT IT DOES NOT KNOW. Not what a line is, not how its URL is built, not which section it
 * belongs to. Quests names files by NPC and event, zones by map id and slug, and zones adds a
 * language the path itself does not carry -- so each section keeps a small adapter that turns
 * its own line into these props. That seam is the whole reason this is one component: the two
 * were the same 200 lines written twice, and they had already drifted to different playback
 * rates and different scrub behaviour.
 */
const RATES = [0.75, 1, 1.25, 1.5, 2];

type Props = {
  /** The audio to play, or undefined when nothing is selected. */
  src: string | undefined;
  /** Who is speaking, or what the line belongs to. */
  title: string | null;
  /** The line's id, set in mono beside the title. */
  meta?: string;
  /** What the line says, one line, clipped. */
  subtitle?: string;
  /** The filename a download should land as. */
  downloadName?: string;
  /**
   * A duration known before the file loads, in seconds.
   *
   * Zones records it on the take, so the total can be shown immediately rather than after
   * the first byte arrives. Quests does not, and passes nothing.
   */
  totalHint?: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
};

export default function AudioPlayer({
  src,
  title,
  meta,
  subtitle,
  downloadName,
  totalHint,
  audioRef,
}: Props) {
  const local = useRef<HTMLAudioElement | null>(null);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  // While dragging, the slider follows the pointer rather than timeupdate events. Without
  // this the thumb fights the playhead and snaps back every 250ms.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  // Both refs point at the same element: this component reads it for its own chrome, the
  // explorer drives playback through it.
  const attach = (el: HTMLAudioElement | null) => {
    local.current = el;
    audioRef.current = el;
  };

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

  // A new clip starts at zero even before its metadata arrives, so the previous one's
  // duration is never briefly shown against the new one's name.
  useEffect(() => {
    setTime(0);
    setDuration(0);
  }, [src]);

  const toggle = () => {
    const el = local.current;
    if (!el?.src) return;
    void (el.paused ? el.play().catch(() => {}) : el.pause());
  };

  const cycleRate = () => {
    const el = local.current;
    if (!el) return;
    el.playbackRate = RATES[(RATES.indexOf(el.playbackRate) + 1) % RATES.length] ?? 1;
  };

  const position = scrubbing ?? time;
  const total = duration || totalHint || 0;

  return (
    <div className="bg-card/95 border-t backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          disabled={!src}
          aria-label={playing ? "Pause" : "Play"}
          className="size-10 shrink-0 rounded-full"
        >
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {title ?? "Nothing playing"}
            {meta && <span className="text-muted-foreground ml-2 font-mono text-xs">{meta}</span>}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {subtitle ?? "Pick a line to hear it."}
          </div>

          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-muted-foreground w-8 shrink-0 text-right font-mono text-[11px]">
              {timecode(position)}
            </span>
            <Slider
              value={[position]}
              max={total || 1}
              step={0.05}
              disabled={!src || !total}
              aria-label="Seek"
              onValueChange={([value]) => setScrubbing(value)}
              // Committed on release, never on every intermediate value: setting currentTime
              // per pointer move restarts the fetch each time.
              onValueCommit={([value]) => {
                if (local.current) local.current.currentTime = value;
                setTime(value);
                setScrubbing(null);
              }}
            />
            <span className="text-muted-foreground w-8 shrink-0 font-mono text-[11px]">
              {timecode(total)}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={cycleRate}
          disabled={!src}
          aria-label="Playback speed"
          className="w-14 shrink-0 font-mono text-xs tabular-nums"
        >
          {rate.toFixed(2).replace(/0$/, "")}x
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            if (local.current) local.current.muted = !local.current.muted;
          }}
          disabled={!src}
          aria-label={muted ? "Unmute" : "Mute"}
          className="shrink-0"
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>

        {/* An anchor, not a fetch: the file is same-origin, so `download` renames it on the
            way out and the browser handles the save. With nothing playing there is no href to
            give, and a disabled anchor is not a thing - hence the plain button. */}
        {src ? (
          <Button size="icon" variant="ghost" asChild className="shrink-0">
            <a
              href={src}
              download={downloadName}
              aria-label="Download this line"
              title={downloadName && `Download ${downloadName}`}
            >
              <Download />
            </a>
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            disabled
            aria-label="Download this line"
            className="shrink-0"
          >
            <Download />
          </Button>
        )}

        <audio ref={attach} preload="metadata" src={src} />
      </div>
    </div>
  );
}
