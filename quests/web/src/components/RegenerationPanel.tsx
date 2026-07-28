"use client";

import { Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Batch } from "./Explorer";

function n(value: number): string {
  return value.toLocaleString();
}

/**
 * What a batch is doing, while it does it.
 *
 * Sits above the player rather than replacing it, because a batch takes minutes and the
 * point of watching is to play the lines as they land.
 *
 * The cost shown is the real one, summed from what ElevenLabs charged each line, not the
 * estimate the dialog offered - so an estimate that was wrong is visible rather than
 * quietly preserved.
 */
export default function RegenerationPanel({
  batch,
  onStop,
  onDismiss,
}: {
  batch: Batch | null;
  onStop: () => void;
  onDismiss: () => void;
}) {
  if (!batch) return null;

  const attempted = batch.done.length + batch.failures.length;
  const total = batch.jobs.length;
  const percent = total ? Math.round((attempted / total) * 100) : 0;
  const running = !batch.finished;

  return (
    <div className="bg-card/95 fixed inset-x-0 bottom-[92px] z-40 border-t backdrop-blur">
      <div className="mx-auto max-w-4xl px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {running && <Loader2 className="size-4 shrink-0 animate-spin" />}

          <span className="font-medium">
            {running ? "Regenerating" : batch.stopped ? "Stopped" : "Finished"} {batch.label}
          </span>

          <span className="text-muted-foreground font-mono text-xs">
            {n(attempted)}/{n(total)}
            {batch.failures.length > 0 && (
              <span className="text-destructive"> · {n(batch.failures.length)} failed</span>
            )}
          </span>

          <span className="text-muted-foreground ml-auto font-mono text-xs">
            {/* Unpriced takes are counted separately rather than folded in as zero, which
                would understate the total and look like a bargain. */}
            {n(batch.credits)} credits
            {batch.unpriced > 0 && ` · ${n(batch.unpriced)} unpriced`}
          </span>

          {running ? (
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

        {batch.current && running && (
          <div className="text-muted-foreground mt-1.5 truncate text-xs">{batch.current}</div>
        )}

        {batch.stoppedBecause && (
          <div role="alert" className="text-destructive mt-1.5 text-xs">
            {batch.stoppedBecause}
          </div>
        )}

        {/* Failures are listed rather than counted: "3 failed" tells you nothing you can
            act on, and the upstream text usually tells you exactly what to fix. */}
        {batch.failures.length > 0 && !running && (
          <ul className="text-muted-foreground mt-1.5 max-h-24 space-y-0.5 overflow-y-auto text-xs">
            {batch.failures.slice(0, 20).map((failed) => (
              <li key={failed.lineId} className="truncate">
                <span className="font-mono">{failed.lineId}</span> — {failed.message}
              </li>
            ))}
            {batch.failures.length > 20 && (
              <li>…and {n(batch.failures.length - 20)} more</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
