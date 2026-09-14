"use client";

import Link from "next/link";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  RefreshCw,
  RotateCcw,
  RotateCw,
} from "lucide-react";

import type { ResultLine } from "@/lib/zones/search";
import { cn } from "@/lib/utils";

export type RowState = { phase: "busy" } | { phase: "done"; version: number } | { phase: "error"; message: string };

type Props = {
  line: ResultLine;
  current: boolean;
  /** Editor and up: the three flag controls are drawn as buttons rather than as read-only marks. */
  canReview: boolean;
  /** Editor and up: the whole Audio column, which is nothing but controls. */
  canRegenerate: boolean;
  /** Editor and up: may read the report bodies, so the count badge expands the row. */
  canTriage: boolean;
  /** Whether the feedback panel is showing beneath this row. */
  expanded: boolean;
  /**
   * How many columns the expanded row has to span.
   *
   * COMPUTED BY Explorer, NOT HERE. The column count is already role-conditional in
   * three places that must move together -- <colgroup>, <thead> and the <td> set below
   * -- and this is a fourth. Deriving it here from canRegenerate would put the same
   * arithmetic in two files and let them disagree the next time a column is added.
   */
  colSpan: number;
  state?: RowState;
  onPlay: (line: ResultLine) => void;
  onNarrowToZone: (line: ResultLine) => void;
  onFlag: (line: ResultLine, status: "bad" | "ok" | null) => void;
  onNote: (line: ResultLine) => void;
  onReport: (line: ResultLine) => void;
  onToggleExpand: (line: ResultLine) => void;
  onEditText: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  onRestore: (line: ResultLine) => void;
};

// The colour discipline is ../wow-voiceover's IssueChip: severity decides whether to
// look, and the label decides where to go next. Red is only ever a real problem.
const STATE_STYLE = {
  missing: "text-destructive",
  stale: "text-amber-400",
  current: "text-muted-foreground",
} as const;

const STATE_LABEL = {
  missing: "no audio",
  stale: "text changed",
  current: "",
} as const;

export function LineRow({
  line,
  current,
  canReview,
  canRegenerate,
  canTriage,
  expanded,
  colSpan,
  state,
  onPlay,
  onNarrowToZone,
  onFlag,
  onNote,
  onReport,
  onToggleExpand,
  onEditText,
  onRegenerate,
  onRestore,
}: Props) {
  const playable = line.state !== "missing";
  const status = line.flag?.status ?? null;
  // More than one take means there is something to go back to. Restoring is free, so
  // the control is only ever hidden when it would do nothing.
  const restorable = (line.take?.takes ?? 0) > 1;

  return (
    <>
      <tr
        className={cn(
          "align-top",
          // The rule moves to the expanded row when there is one, so the panel reads as
          // part of this line rather than as the start of the next.
          !expanded && "border-b border-border",
          current && "bg-muted",
          playable && !current && "hover:bg-muted/60",
        )}
      >
        {/* Narrowing is a sibling of the play button below, never nested inside it: a
            <button> within a <button> is invalid HTML and the inner click never fires. */}
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={() => onNarrowToZone(line)}
            className="text-left hover:text-primary hover:underline"
            title={`Show only ${line.zoneName}`}
          >
            {line.zoneName}
          </button>
        </td>

        <td className="px-2 py-1.5">
          {line.kind === "zone" ? (
            <span className="text-muted-foreground italic">zone line</span>
          ) : (
            <span>{line.name}</span>
          )}
        </td>

        <td className="px-2 py-1.5 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {/* Without review rights the verdict is still worth seeing -- "someone has
                already reported this one" is the answer to the question a listener who
                dislikes a line is about to ask -- but only when there is one. An empty
                row of greyed-out controls advertises three things that cannot be done. */}
            {!canReview && status === "bad" && (
              <span className="flex items-center gap-0.5 rounded bg-destructive/15 px-1 text-xs text-destructive">
                <AlertTriangle size={11} /> bad
              </span>
            )}
            {!canReview && status === "ok" && (
              <span className="flex items-center gap-0.5 px-1 text-xs text-emerald-400">
                <Check size={11} /> ok
              </span>
            )}

            {/* Clicking the verdict you already hold clears it, so a mis-tap is undone
                where it was made rather than through a separate control. */}
            {canReview && (
              <>
                <button
                  type="button"
                  aria-pressed={status === "bad"}
                  onClick={() => onFlag(line, status === "bad" ? null : "bad")}
                  title={line.flag?.note ?? (status === "bad" ? "Clear (u)" : "Flag as bad (f)")}
                  className={cn(
                    "flex items-center gap-0.5 rounded px-1 text-xs",
                    status === "bad" ? "bg-destructive/15 text-destructive" : "text-muted-foreground/40 hover:text-destructive",
                  )}
                >
                  <AlertTriangle size={11} />
                  {status === "bad" && "bad"}
                </button>

                <button
                  type="button"
                  aria-pressed={status === "ok"}
                  onClick={() => onFlag(line, status === "ok" ? null : "ok")}
                  title={status === "ok" ? "Clear (u)" : "Reviewed, sounds fine (g)"}
                  className={cn(
                    "flex items-center gap-0.5 rounded px-1 text-xs",
                    status === "ok" ? "text-emerald-400" : "text-muted-foreground/40 hover:text-emerald-400",
                  )}
                >
                  <Check size={11} />
                  {status === "ok" && "ok"}
                </button>

                <button
                  type="button"
                  onClick={() => onNote(line)}
                  title={line.flag?.note ? line.flag.note : "Add a note (n)"}
                  className={cn(
                    "rounded px-0.5 text-xs",
                    line.flag?.note ? "text-primary" : "text-muted-foreground/40 hover:text-foreground",
                  )}
                >
                  <MessageSquare size={11} />
                </button>
              </>
            )}

            {/* Filing a report is the one write open to everyone, so this button is drawn
                for everyone -- a guest who dislikes a line has nowhere else to put it.
                It is not the same control as the note button above: that one is an
                editor writing on their own worklist. */}
            <button
              type="button"
              onClick={() => onReport(line)}
              title="Report a problem with this line"
              className="rounded px-0.5 text-xs text-muted-foreground/40 hover:text-foreground"
            >
              <MessageSquarePlus size={11} />
            </button>

            {/* Sits with the other per-line judgements rather than in the Audio column:
                rewriting the prose is not an audio action, and it is free. It is gated on
                canRegenerate because the edit is what a later regeneration would speak,
                and /api/zones/lore holds the same line. */}
            {canRegenerate && (
              <button
                type="button"
                onClick={() => onEditText(line)}
                title="Rewrite this line's text"
                className="rounded px-0.5 text-xs text-muted-foreground/40 hover:text-foreground"
              >
                <Pencil size={11} />
              </button>
            )}

            {/* The count is public; the bodies are not. So everyone sees how many open
                reports a line carries -- the same argument the `bad` badge above makes --
                and a triager gets a link to where they can be read.

                A link to /reports rather than a panel inside the row. The zones site
                expanded the row and fetched the bodies, which was a second surface for
                what /reports already is -- and the merged triage page shows both
                sections, so a report about a zone and one about a quest are now one
                queue to work through rather than two places to remember to look. */}
            {line.reportsOpen > 0 &&
              (canTriage ? (
                <Link
                  href="/reports?source=zones"
                  title={`${line.reportsOpen} open report${line.reportsOpen === 1 ? "" : "s"}`}
                  className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-xs text-amber-400"
                >
                  <MessageSquare size={11} />
                  {line.reportsOpen}
                </Link>
              ) : (
                <span
                  className="flex items-center gap-0.5 rounded bg-amber-500/15 px-1 text-xs text-amber-400"
                  title={`${line.reportsOpen} open report${line.reportsOpen === 1 ? "" : "s"}`}
                >
                  <MessageSquare size={11} />
                  {line.reportsOpen}
                </span>
              ))}

            {STATE_LABEL[line.state] && (
              <span className={cn("text-xs", STATE_STYLE[line.state])}>{STATE_LABEL[line.state]}</span>
            )}
            {line.take && line.take.takes > 1 && (
              <span
                className="flex items-center gap-0.5 text-xs text-muted-foreground"
                title={`${line.take.takes} takes; v${line.take.version} is live`}
              >
                <RotateCw size={10} /> v{line.take.version}
              </span>
            )}
          </div>
        </td>

        {/* The only click-to-play cell. data-line-key is what the keyboard handler
            scrolls into view. */}
        <td className="p-0">
          <button
            type="button"
            data-line-key={line.id}
            aria-current={current}
            disabled={!playable}
            onClick={() => onPlay(line)}
            className={cn(
              "w-full px-2 py-1.5 text-left disabled:cursor-default",
              !playable && "opacity-50",
            )}
            title={playable ? `${line.file}.mp3` : "No audio yet"}
          >
            {/* An untranslated line is empty, not English: see buildOverlaidCatalogue.
                The word stands in for the text so the row is still clickable and still
                says what it is, without putting prose there that nobody wrote in this
                language. Styled as the State column's "no audio" is: both mean the same
                thing for this language -- the line is not there yet. */}
            {line.translated === false ? (
              <span className={cn("block text-xs", STATE_STYLE.missing)}>no translation</span>
            ) : (
              <span className={cn("block whitespace-pre-wrap", !current && "clamp-2")}>
                {line.text}
              </span>
            )}
          </button>
        </td>

        <td className="px-2 py-1.5 text-right whitespace-nowrap font-mono text-xs text-muted-foreground">
          {line.chars}
          {line.short && (
            <span className="ml-1 text-amber-400" title="Under 250 characters, where v3 is least reliable">
              !
            </span>
          )}
        </td>

        {/* The whole cell, not its contents: Explorer drops the matching <col> and <th>,
            so a <td> left behind here would slide every row's columns out of the header. */}
        {canRegenerate && (
          <td className="px-2 py-1.5 whitespace-nowrap">
            <div className="flex items-center justify-end gap-1">
              {/* Precedence: an error is what you need to read, then a fresh success,
                  then the controls. Showing all three at once buries the one that matters. */}
              {state?.phase === "error" ? (
                <span className="truncate text-xs text-destructive" title={state.message}>
                  {state.message}
                </span>
              ) : state?.phase === "done" ? (
                <span className="text-xs text-emerald-400">v{state.version}</span>
              ) : null}

              {restorable && (
                <button
                  type="button"
                  onClick={() => onRestore(line)}
                  title="Restore an earlier take (free)"
                  className="rounded p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground"
                >
                  <RotateCcw size={13} />
                </button>
              )}

              <button
                type="button"
                disabled={state?.phase === "busy"}
                onClick={() => onRegenerate(line)}
                title="Regenerate this line (spends credits)"
                className="rounded p-1 text-muted-foreground/50 hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                {state?.phase === "busy" ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <RefreshCw size={13} />
                )}
              </button>
            </div>
          </td>
        )}
      </tr>

    </>
  );
}
