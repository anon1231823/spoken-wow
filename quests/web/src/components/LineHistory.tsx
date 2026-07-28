"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { History, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type Take = {
  version: number;
  isCurrent: boolean;
  origin: "inherited" | "generated";
  playable: boolean;
  characters: number | null;
  credits: number | null;
  modelId: string | null;
  createdAt: string;
  createdByName: string | null;
};

function when(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Every take of one line, with the option to go back to any of them.
 *
 * Version 0 is the take that predates this app, and is labelled as such: nothing recorded
 * how it was made, so there is no model or cost to show and inventing one would suggest it
 * could be reproduced. It is also the one take that is never pruned.
 */
export default function LineHistory({
  file,
  onRestored,
}: {
  file: string;
  /** Called with the version now live, so the row and the player can catch up. */
  onRestored: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  // One element for the popover rather than one per row: opening a second take should stop
  // the first, and the page's main player is deliberately left alone.
  const preview = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/lines/versions?file=${encodeURIComponent(file)}`);
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not read history (${response.status})`);
        return;
      }
      setTakes(body.versions as Take[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [file]);

  useEffect(() => {
    if (open) void load();
    else {
      preview.current?.pause();
      setPlaying(null);
    }
  }, [open, load]);

  // Stop the preview when the popover unmounts, or it keeps playing invisibly.
  useEffect(() => () => preview.current?.pause(), []);

  function togglePlay(version: number) {
    const element = preview.current;
    if (!element) return;

    if (playing === version) {
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = `/api/audio-history/${file.replace(/\.mp3$/, "")}/${version}.mp3`;
    void element.play().catch(() => setPlaying(null));
    setPlaying(version);
  }

  async function restore(version: number) {
    setBusy(version);
    setError(null);
    try {
      const response = await fetch("/api/lines/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, version }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not restore (${response.status})`);
        return;
      }
      onRestored(version);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" title="Earlier takes of this line">
          <History />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96">
        <div className="mb-2 text-sm font-medium">Takes</div>

        {error && (
          <p role="alert" className="text-destructive mb-2 text-xs">
            {error}
          </p>
        )}

        {takes === null ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : takes.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No earlier takes. The first regeneration keeps whatever is there now.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {takes.map((take) => (
              <li
                key={take.version}
                className={cn(
                  "flex items-start gap-2 rounded-md px-1.5 py-1 text-xs",
                  take.isCurrent && "bg-muted",
                )}
              >
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={!take.playable}
                  title={take.playable ? "Play this take" : "This take's audio is gone"}
                  onClick={() => togglePlay(take.version)}
                >
                  {playing === take.version ? <Pause /> : <Play />}
                </Button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono">v{take.version}</span>
                    {take.origin === "inherited" && (
                      <span className="text-amber-400">original</span>
                    )}
                    {take.isCurrent && <span className="text-emerald-400">live</span>}
                    {!take.playable && <span className="text-destructive">audio gone</span>}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {when(take.createdAt)}
                    {take.createdByName && ` · ${take.createdByName}`}
                    {/* Nothing recorded how the inherited take was made, so nothing is
                        claimed about it. */}
                    {take.credits !== null && ` · ${take.credits} credits`}
                  </div>
                </div>

                {!take.isCurrent && (
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={!take.playable || busy !== null}
                    onClick={() => void restore(take.version)}
                    title={
                      take.playable
                        ? "Put this take back in the store"
                        : "This take's audio is gone, so it cannot be restored"
                    }
                  >
                    {busy === take.version ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        <audio ref={preview} onEnded={() => setPlaying(null)} className="hidden" />
      </PopoverContent>
    </Popover>
  );
}
