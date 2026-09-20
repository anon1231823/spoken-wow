"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Source } from "@/lib/generation/client";
import { cn } from "@/lib/utils";

export type Take = {
  version: number;
  isCurrent: boolean;
  origin: "inherited" | "imported" | "generated";
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
 * Which take is live, and every take it could be instead.
 *
 * ONE CONTROL, NOT TWO. The version label and the way back used to be separate things, and
 * only on some rows: zones printed `v3` beside a restore button that silently put back
 * whichever clip was newest, quests hid a history popover behind a second icon, and books
 * had neither although its takes were in the same table. The label is the trigger now --
 * the number is the question, and "which other numbers are there" is what a click asks.
 *
 * Restoring moves the live flag rather than writing a new take, so this list is the set of
 * takes the line has had and not a log of who looked at it. A take whose bytes cannot be
 * found is shown greyed out rather than hidden: the row is still a true record that the
 * take existed, and offering a restore that would fail is worse than saying so.
 *
 * Version 0 is the take that predates this app, labelled `original`: nothing recorded how
 * it was made, so no model or cost is shown and inventing one would suggest it could be
 * reproduced. The zones and books equivalent is an imported take.
 */
export default function TakeSelector({
  source,
  file,
  version,
  takes,
  onRestored,
}: {
  source: Source;
  /** Store-relative, as the row carries it: 'gossip/31ab….mp3' or '1411/razor-hill'. */
  file: string;
  /** The live version, for the trigger. Null where nothing has been cut yet. */
  version: number | null;
  /** How many takes exist, so a line with one says so without being opened. */
  takes: number;
  /** Called with the version now live, so the row and the player can catch up. */
  onRestored: (version: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Take[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  // One element for the popover rather than one per row: opening a second take should stop
  // the first, and the page's main player is deliberately left alone.
  const preview = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ source, file });
      const response = await fetch(`/api/takes?${params}`);
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not read the takes (${response.status})`);
        return;
      }
      setList(body.takes as Take[]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [source, file]);

  useEffect(() => {
    if (open) void load();
    else {
      preview.current?.pause();
      setPlaying(null);
    }
  }, [open, load]);

  // Stop the preview when the popover unmounts, or it keeps playing invisibly.
  useEffect(() => () => preview.current?.pause(), []);

  function togglePlay(take: number) {
    const element = preview.current;
    if (!element) return;

    if (playing === take) {
      element.pause();
      setPlaying(null);
      return;
    }
    element.src = `/api/takes/audio?${new URLSearchParams({
      source,
      file,
      version: String(take),
    })}`;
    void element.play().catch(() => setPlaying(null));
    setPlaying(take);
  }

  async function restore(take: number) {
    setBusy(take);
    setError(null);
    try {
      const response = await fetch("/api/takes/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, file, version: take }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `could not restore (${response.status})`);
        return;
      }
      onRestored(take);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  }

  // Nothing to choose between, so the number is printed rather than offered. A line with
  // one take says `v1`, which is what every untouched line is.
  if (takes <= 1) {
    return version === null ? null : (
      <span className="text-muted-foreground font-mono text-xs" title="The only take">
        v{version}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={`${takes} takes; v${version} is live`}
          aria-label={`Choose which of ${takes} takes is live`}
          className={cn(
            "text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-0.5 rounded-sm font-mono text-xs",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
          )}
        >
          v{version}
          <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-96">
        <div className="mb-2 text-sm font-medium">Takes</div>

        {error && (
          <p role="alert" className="text-destructive mb-2 text-xs">
            {error}
          </p>
        )}

        {list === null ? (
          <p className="text-muted-foreground text-xs">Loading…</p>
        ) : list.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No takes recorded. The first regeneration keeps whatever is there now.
          </p>
        ) : (
          // Capped and scrolled, because nothing prunes takes any more: a line re-rolled
          // two hundred times has two hundred rows here, and a list that long runs off the
          // bottom of the screen with the newest takes -- the ones anyone is looking for --
          // above the fold but the rest unreachable.
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {list.map((take) => (
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
                  title={take.playable ? "Play this take" : "This take's audio cannot be found"}
                  onClick={() => togglePlay(take.version)}
                >
                  {playing === take.version ? <Pause /> : <Play />}
                </Button>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-mono">v{take.version}</span>
                    {take.origin !== "generated" && (
                      <span className="text-amber-400">original</span>
                    )}
                    {take.isCurrent && <span className="text-emerald-400">live</span>}
                    {!take.playable && <span className="text-destructive">audio gone</span>}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {when(take.createdAt)}
                    {take.createdByName && ` · ${take.createdByName}`}
                    {/* Nothing recorded how an inherited take was made, so nothing is
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
                        ? "Make this the take the addon plays"
                        : "This take's audio cannot be found, so it cannot be restored"
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
