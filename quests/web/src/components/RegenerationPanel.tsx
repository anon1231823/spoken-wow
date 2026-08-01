"use client";

import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { QueueSnapshot } from "@/lib/generation/client";

function n(value: number): string {
  return value.toLocaleString();
}

/**
 * What the queue is doing, while it does it.
 *
 * Sits above the player rather than replacing it, because a batch takes minutes and the
 * point of watching is to play the lines as they land.
 *
 * It shows the whole queue, not this tab's work: there is one ElevenLabs account and one
 * budget, so a batch another admin started is spending the same money and Stop had better
 * reach it.
 *
 * The cost shown is the real one, summed from what ElevenLabs charged each line, not the
 * estimate the dialog offered - so an estimate that was wrong is visible rather than quietly
 * preserved.
 *
 * `note` answers the click rather than the batch: it says what the enqueue request itself
 * reported (refused outright, or queued fewer files than quoted because another admin had
 * already claimed some) - information the server snapshot has no field for, since it is
 * about one request rather than the queue's ongoing state.
 */
export default function RegenerationPanel({
  queue,
  note,
  onStop,
  onDismiss,
}: {
  queue: QueueSnapshot | null;
  note: string | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const counts = queue?.counts;
  const total = counts
    ? counts.pending + counts.running + counts.done + counts.failed + counts.cancelled
    : 0;

  if (total === 0) {
    // Without a batch to show, this is the only way a refused or partly-skipped click gets
    // an answer at all - the alternative is a button that appears to do nothing.
    if (!note) return null;
    return (
      <div className="bg-card/95 fixed inset-x-0 bottom-[92px] z-40 border-t backdrop-blur">
        <div className="text-muted-foreground mx-auto max-w-6xl px-5 py-2.5 text-sm">{note}</div>
      </div>
    );
  }

  // `queue` cannot be null here: total > 0 only when counts came from a real snapshot.
  const snapshot = queue!;
  const { pending, running, done, failed, cancelled } = counts!;
  const attempted = done + failed;
  const percent = total ? Math.round((attempted / total) * 100) : 0;
  const active = snapshot.active;

  return (
    <div className="bg-card/95 fixed inset-x-0 bottom-[92px] z-40 border-t backdrop-blur">
      <div className="mx-auto max-w-6xl px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {active && <Loader2 className="size-4 shrink-0 animate-spin" />}

          <span className="font-medium">
            {active ? "Regenerating" : cancelled > 0 ? "Stopped" : "Finished"}
          </span>

          <span className="text-muted-foreground font-mono text-xs">
            {n(attempted)}/{n(total)}
            {/* The number in flight is the visible proof this is no longer sequential. */}
            {running > 0 && <span> · {n(running)} at once</span>}
            {failed > 0 && <span className="text-destructive"> · {n(failed)} failed</span>}
            {cancelled > 0 && <span> · {n(cancelled)} cancelled</span>}
          </span>

          <span className="text-muted-foreground ml-auto font-mono text-xs">
            {/* Unpriced takes are counted separately rather than folded in as zero, which
                would understate the total and look like a bargain. */}
            {n(snapshot.credits)} credits
            {snapshot.unpriced > 0 && ` · ${n(snapshot.unpriced)} unpriced`}
          </span>

          {active ? (
            <Button size="xs" variant="secondary" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss">
              <X />
            </Button>
          )}
        </div>

        <div className="bg-muted mt-2 h-1 overflow-hidden rounded-full">
          <div
            className="bg-primary h-full transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>

        {note && <div className="text-muted-foreground mt-1.5 text-xs">{note}</div>}

        {snapshot.running.length > 0 && active && (
          <div className="text-muted-foreground mt-1.5 truncate text-xs">
            {snapshot.running.map((job) => `${job.npcName} — ${job.preview}`).join(" · ")}
          </div>
        )}

        {snapshot.stoppedBecause && (
          <div role="alert" className="text-destructive mt-1.5 text-xs">
            {snapshot.stoppedBecause}
          </div>
        )}

        {/* Failures are listed rather than counted: "3 failed" tells you nothing you can act
            on, and the upstream text usually tells you exactly what to fix. */}
        {snapshot.failures.length > 0 && !active && (
          <ul className="text-muted-foreground mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs">
            {snapshot.failures.map((job) => (
              <li key={job.lineId} className="truncate">
                <span className="font-mono">{job.lineId}</span> — {job.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
