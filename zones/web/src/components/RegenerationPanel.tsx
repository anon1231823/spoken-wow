"use client";

import { Loader2, X } from "lucide-react";

import type { Batch } from "@/lib/regenerate";

// What a running batch is doing.
//
// Failures are listed rather than counted, for ../wow-voiceover's reason: "3 failed"
// tells you nothing you can act on, and the upstream text usually tells you exactly
// what to fix -- a quota wall and a malformed line need completely different responses.

type Props = {
  batch: Batch | null;
  onStop: () => void;
  onDismiss: () => void;
};

export function RegenerationPanel({ batch, onStop, onDismiss }: Props) {
  if (!batch) return null;

  const done = batch.jobs.filter((job) => job.state === "done");
  const failed = batch.jobs.filter((job) => job.state === "failed");
  const running = batch.jobs.filter((job) => job.state === "running");
  const attempted = done.length + failed.length;
  const total = batch.jobs.length;
  const active = batch.finishedAt === null;

  const credits = done.reduce((n, job) => n + (job.credits ?? 0), 0);
  const unpriced = done.filter((job) => job.credits === null || job.credits === undefined).length;

  return (
    <div className="border-t border-border bg-panel px-4 py-2">
      <div className="flex items-center gap-3">
        {active && <Loader2 size={14} className="animate-spin text-accent" />}
        <span className="font-medium">
          {active ? "Regenerating" : batch.stoppedBecause ? "Stopped" : "Finished"}
        </span>
        <span className="text-muted">
          {attempted}/{total}
          {running.length > 0 && ` · ${running.length} at once`}
          {failed.length > 0 && <span className="text-bad"> · {failed.length} failed</span>}
        </span>

        <span className="ml-auto font-mono text-xs text-muted">
          {credits.toLocaleString()} credits
          {unpriced > 0 && ` · ${unpriced} unpriced`}
        </span>

        {active ? (
          <button
            type="button"
            onClick={onStop}
            className="rounded border border-border px-2 py-0.5 hover:bg-panel-hover"
          >
            Stop
          </button>
        ) : (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="rounded p-1 hover:bg-panel-hover">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-1.5 h-px w-full bg-border">
        <div
          className="h-px bg-accent transition-[width]"
          style={{ width: `${total === 0 ? 0 : Math.round((attempted / total) * 100)}%` }}
        />
      </div>

      {running.length > 0 && (
        <p className="mt-1 truncate text-xs text-faint">
          {running.map((job) => job.name).join(" · ")}
        </p>
      )}

      {batch.stoppedBecause && batch.stoppedBecause !== "stopped" && (
        <p className="mt-1 text-xs text-bad">{batch.stoppedBecause}</p>
      )}

      {failed.length > 0 && (
        <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-bad">
          {failed.map((job) => (
            <li key={job.lineId} className="truncate">
              {job.name}: {job.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
