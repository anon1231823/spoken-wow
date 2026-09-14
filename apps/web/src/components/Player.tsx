"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Pause, Play, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { ResultLine } from "@/lib/search";

/** Playback rates worth having for dialog: slow enough to catch a mangled word. */
const RATES = [0.75, 1, 1.25, 1.5];

/**
 * What the file should be called once it leaves the store.
 *
 * The store path flattened rather than its basename, because the subfolder is part of the
 * identity: quests/ and gossip/ are separate namespaces, and a downloads folder is not.
 */
function downloadName(line: ResultLine): string {
  return line.audioPath.replace("/", "-");
}

function timecode(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

type Props = {
  line: ResultLine | null;
  /**
   * The take currently in the store, when this line has been regenerated in this session.
   *
   * Appended to the audio URL as a cache buster. Replacing a line does not change its path -
   * the addon resolves sounds by filename, so it cannot - and /api/audio answers with a weak
   * ETag that a cached response need not revalidate, so without this the browser replays the
   * take that was just overwritten.
   */
  version?: number;
};

/**
 * One shared <audio> element for the whole page, so starting a line stops the previous
 * one without any bookkeeping across rows.
 *
 * The element stays a plain <audio> and is exposed through the forwarded ref, because
 * Explorer drives playback imperatively - space toggles, j/k step between lines. The
 * chrome here is presentation over that element, not a replacement for it.
 */
export default function Player({
  line,
  version,
  ref,
}: Props & { ref?: React.RefObject<HTMLAudioElement | null> }) {
  const audio = useRef<HTMLAudioElement | null>(null);

  // Both refs point at the same element: this component reads it for its own chrome,
  // Explorer drives playback through it.
  const attach = (el: HTMLAudioElement | null) => {
    audio.current = el;
    if (ref) ref.current = el;
  };

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [muted, setMuted] = useState(false);
  // While dragging, the slider must follow the pointer rather than timeupdate events.
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;

    const onTime = () => setTime(el.currentTime);
    const onMeta = () => setDuration(el.duration);
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

  // A new line means a new file: reset the readout rather than showing the old one's
  // position until the first timeupdate lands.
  useEffect(() => {
    setTime(0);
    setDuration(0);
  }, [line?.lineId]);

  const toggle = () => {
    const el = audio.current;
    if (!el?.src) return;
    void (el.paused ? el.play().catch(() => {}) : el.pause());
  };

  const cycleRate = () => {
    const el = audio.current;
    if (!el) return;
    el.playbackRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
  };

  const position = scrubbing ?? time;

  // One URL for both the element and the download, so a take regenerated in this session is
  // the one that gets saved rather than whatever the browser still has cached.
  const src = line
    ? `/api/quests/audio/${line.audioPath}${version === undefined ? "" : `?v=${version}`}`
    : undefined;

  return (
    <div className="bg-card/95 border-t backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
        <Button
          size="icon"
          variant="secondary"
          onClick={toggle}
          disabled={!line}
          aria-label={playing ? "Pause" : "Play"}
          className="size-10 shrink-0 rounded-full"
        >
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {line ? line.npcName : "Nothing playing"}
            {line && (
              <span className="text-muted-foreground ml-2 font-mono text-xs">
                {line.lineId}
              </span>
            )}
          </div>
          <div className="text-muted-foreground truncate text-xs">
            {line ? line.text : "Pick a line to hear it."}
          </div>

          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-muted-foreground w-8 shrink-0 text-right font-mono text-[11px]">
              {timecode(position)}
            </span>
            <Slider
              value={[position]}
              max={duration || 1}
              step={0.05}
              disabled={!line || !duration}
              aria-label="Seek"
              onValueChange={([value]) => setScrubbing(value)}
              onValueCommit={([value]) => {
                if (audio.current) audio.current.currentTime = value;
                setTime(value);
                setScrubbing(null);
              }}
            />
            <span className="text-muted-foreground w-8 shrink-0 font-mono text-[11px]">
              {timecode(duration)}
            </span>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={cycleRate}
          disabled={!line}
          aria-label="Playback speed"
          className="w-14 shrink-0 font-mono text-xs tabular-nums"
        >
          {rate.toFixed(2).replace(/0$/, "")}x
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            if (audio.current) audio.current.muted = !audio.current.muted;
          }}
          disabled={!line}
          aria-label={muted ? "Unmute" : "Mute"}
          className="shrink-0"
        >
          {muted ? <VolumeX /> : <Volume2 />}
        </Button>

        {/* An anchor, not a fetch: the file is same-origin, so `download` renames it on the
            way out and the browser handles the save. With nothing playing there is no href
            to give, and a disabled anchor is not a thing - hence the plain button. */}
        {line && src ? (
          <Button size="icon" variant="ghost" asChild className="shrink-0">
            <a
              href={src}
              download={downloadName(line)}
              aria-label="Download this line"
              title={`Download ${downloadName(line)}`}
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
