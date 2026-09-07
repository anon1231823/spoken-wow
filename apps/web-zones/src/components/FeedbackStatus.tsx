"use client";

import { useState } from "react";

import { STATUS_LABEL, STATUSES, type FeedbackReport, type Status } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The three status buttons, and the fetch behind them.
 *
 * Shared by the explorer's expanded row and the /feedback page so the two cannot drift
 * into disagreeing about what closing a report does -- they are the same action reached
 * from two places, and the page is the one a triager works through while the panel is
 * the one they reach for mid-listen.
 *
 * Not optimistic, unlike the flag buttons in Explorer. Flagging happens once a second
 * during a listening pass and has to feel instant; ruling on a report happens after
 * reading a paragraph, and a wrong answer that appears and then reverts is worse than a
 * half-second wait.
 */

type Props = {
  report: FeedbackReport;
  /** Called with the updated fields once the server has agreed. */
  onChanged: (id: number, status: Status, resolverEmail: string | null) => void;
};

const STYLE: Record<Status, string> = {
  open: "text-warn",
  not_an_issue: "text-muted",
  fixed: "text-good",
};

export function FeedbackStatus({ report, onChanged }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(status: Status) {
    if (status === report.status) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/feedback/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: report.id, status }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        resolverEmail?: string | null;
      };
      if (!response.ok) {
        setError(data.error ?? "Could not save that.");
        return;
      }
      onChanged(report.id, status, data.resolverEmail ?? null);
    } catch {
      setError("Could not save that.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {STATUSES.map((status) => (
        <button
          key={status}
          type="button"
          disabled={pending}
          aria-pressed={report.status === status}
          onClick={() => void set(status)}
          className={cn(
            "rounded border px-1.5 py-0.5 text-xs whitespace-nowrap disabled:opacity-40",
            report.status === status
              ? cn("border-border bg-panel-hover", STYLE[status])
              : "border-transparent text-faint/60 hover:border-border hover:text-fg",
          )}
        >
          {/* Reopening is one of the three, not a separate undo: a mis-clicked "fixed"
              is undone where it was made. */}
          {STATUS_LABEL[status]}
        </button>
      ))}
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
    </span>
  );
}
