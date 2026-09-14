"use client";

import {
  AlertTriangle,
  Check,
  ChevronDownIcon,
  FlagIcon,
  MessageSquare,
  PencilIcon,
  PlayIcon,
  RotateCcw,
  RotateCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import RegenerateButton from "@/components/RegenerateButton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResultLine } from "@/lib/zones/search";

export type RowState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

type Props = {
  line: ResultLine;
  current: boolean;
  /** Editor and up: the flag controls are drawn as buttons rather than as read-only marks. */
  canReview: boolean;
  /** Editor and up: the rewrite, restore and regenerate controls. */
  canRegenerate: boolean;
  /** Editor and up: may read the report bodies, so the count badge links to the queue. */
  canTriage: boolean;
  state?: RowState;
  onPlay: (line: ResultLine) => void;
  onNarrowToZone: (line: ResultLine) => void;
  onFlag: (line: ResultLine, status: "bad" | "ok" | null) => void;
  onNote: (line: ResultLine) => void;
  onReport: (line: ResultLine) => void;
  onEditText: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  onRestore: (line: ResultLine) => void;
};

// The same colour discipline as the quests explorer: red is only ever a real problem, amber
// is something that has drifted, grey is a fact about the row.
const STATE_STYLE = {
  missing: "text-destructive",
  stale: "text-amber-300",
  current: "text-muted-foreground",
} as const;

const STATE_LABEL = {
  missing: "no audio",
  stale: "audio outdated",
  current: "",
} as const;

export function LineRow({
  line,
  current,
  canReview,
  canRegenerate,
  canTriage,
  state,
  onPlay,
  onNarrowToZone,
  onFlag,
  onNote,
  onReport,
  onEditText,
  onRegenerate,
  onRestore,
}: Props) {
  const playable = line.state !== "missing";
  const status = line.flag?.status ?? null;
  // More than one take means there is something to go back to. Restoring is free, so the
  // control is only ever hidden when it would do nothing.
  const restorable = (line.take?.takes ?? 0) > 1;
  const [expanded, setExpanded] = useState(false);

  /**
   * Clicking the row shows the whole line, but only when the click meant that.
   *
   * Two things it must not swallow. Every control in the row is a descendant of this
   * handler, so a click that landed on one of them is that button's business rather than a
   * toggle. And a click that ends a drag over the prose is someone copying it, which is the
   * other half of what this cell is for.
   */
  function toggleFromRow(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='dialog']")) return;
    if (!window.getSelection()?.isCollapsed) return;
    setExpanded((open) => !open);
  }

  return (
    <tr
      data-line-key={line.id}
      onClick={toggleFromRow}
      className={cn(
        "border-border/60 border-b align-top transition-colors",
        "hover:bg-muted/60",
        current && "bg-muted",
      )}
    >
      {/* Narrowing is a sibling of the play button below, never nested inside it: a
          <button> within a <button> is invalid HTML and the inner click never fires. */}
      <td className="px-2 py-2">
        <button
          className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
          title={`Show only ${line.zoneName}`}
          onClick={() => onNarrowToZone(line)}
        >
          {line.zoneName}
        </button>
      </td>

      <td className="px-2 py-2">
        {line.kind === "zone" ? (
          <span className="text-muted-foreground italic">zone line</span>
        ) : (
          <span className="block truncate">{line.name}</span>
        )}
      </td>

      {/* The reviewer's verdict on this line, which is the zones section's own column: the
          quests explorer has a machine's finding here instead. */}
      <td className="px-2 py-2 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          {/* Without review rights the verdict is still worth seeing -- "someone has already
              reported this one" is the answer to the question a listener who dislikes a line
              is about to ask -- but only when there is one. An empty row of greyed-out
              controls advertises three things that cannot be done. */}
          {!canReview && status === "bad" && (
            <span className="bg-destructive/15 text-destructive flex items-center gap-0.5 rounded px-1 text-xs">
              <AlertTriangle size={11} /> bad
            </span>
          )}
          {!canReview && status === "ok" && (
            <span className="flex items-center gap-0.5 px-1 text-xs text-emerald-400">
              <Check size={11} /> ok
            </span>
          )}

          {/* Clicking the verdict you already hold clears it, so a mis-tap is undone where it
              was made rather than through a separate control. */}
          {canReview && (
            <>
              <button
                type="button"
                aria-pressed={status === "bad"}
                onClick={() => onFlag(line, status === "bad" ? null : "bad")}
                title={line.flag?.note ?? (status === "bad" ? "Clear (u)" : "Flag as bad (f)")}
                className={cn(
                  "flex items-center gap-0.5 rounded px-1 text-xs",
                  status === "bad"
                    ? "bg-destructive/15 text-destructive"
                    : "text-muted-foreground/40 hover:text-destructive",
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
                  status === "ok"
                    ? "text-emerald-400"
                    : "text-muted-foreground/40 hover:text-emerald-400",
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
                  line.flag?.note
                    ? "text-primary"
                    : "text-muted-foreground/40 hover:text-foreground",
                )}
              >
                <MessageSquare size={11} />
              </button>
            </>
          )}

          {/* The count is public; the bodies are not. So everyone sees how many open reports
              a line carries -- the same argument the `bad` badge above makes -- and a triager
              gets a link to where they can be read. A link to /reports rather than a panel
              inside the row: the merged triage page shows both sections, so a report about a
              zone and one about a quest are one queue rather than two places to look. */}
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
        </div>
      </td>

      {/* The prose is plain markup rather than the label of a button, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied. That
          is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          <button
            aria-current={current}
            disabled={!playable}
            onClick={() => onPlay(line)}
            title={playable ? `${line.file}.mp3` : undefined}
            aria-label={`Play ${line.name}`}
            className={cn(
              "mt-px shrink-0 rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              playable
                ? "text-muted-foreground hover:text-foreground cursor-pointer"
                : "text-muted-foreground/30 cursor-default",
              current && "text-foreground",
            )}
          >
            <PlayIcon className="size-3.5" />
          </button>

          {/* An untranslated line is empty, not English: see buildOverlaidCatalogue. The word
              stands in for the text so the row still says what it is, without putting prose
              there that nobody wrote in this language. */}
          {line.translated === false ? (
            <span className={cn("min-w-0 flex-1 text-xs", STATE_STYLE.missing)}>
              no translation
            </span>
          ) : (
            <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "clamp-2")}>
              {line.text}
            </span>
          )}

          {/* The regeneration outcome replaces the state chips: once a line has just been
              made, "no audio" is stale and confusing rather than merely redundant. */}
          {state?.phase === "error" ? (
            <span className="text-destructive mt-0.5 max-w-[12rem] shrink-0 text-right text-xs">
              {state.message}
            </span>
          ) : state?.phase === "done" ? (
            <span className="mt-0.5 shrink-0 text-xs text-emerald-400">
              regenerated · v{state.version}
            </span>
          ) : (
            STATE_LABEL[line.state] && (
              <span className={cn("mt-0.5 shrink-0 text-xs", STATE_STYLE[line.state])}>
                {STATE_LABEL[line.state]}
              </span>
            )
          )}

          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle needs
              a real control. It doubles as the only thing on screen saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this line" : "Show the whole line"}
            title={expanded ? "Collapse" : "Show the whole line"}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              "text-muted-foreground hover:text-foreground mt-px shrink-0 cursor-pointer rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
            )}
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        </div>
      </td>

      <td className="py-1.5 pr-1 pl-0">
        <span className="flex items-center justify-end gap-1">
          {/* Which take is live, beside the two controls that change it. A line with one
              take says nothing: v1 is what every untouched line is. */}
          {line.take && line.take.takes > 1 && (
            <span
              className="text-muted-foreground flex items-center gap-0.5 font-mono text-xs"
              title={`${line.take.takes} takes; v${line.take.version} is live`}
            >
              <RotateCw size={10} /> v{line.take.version}
            </span>
          )}

          {/* Outside the canRegenerate gate, deliberately: reporting is what a visitor who
              cannot sign in has, and /api/reports is unauthenticated for the same reason. */}
          <Button
            variant="ghost"
            size="icon"
            title="Report a problem with this line"
            aria-label={`Report ${line.name}`}
            onClick={() => onReport(line)}
          >
            <FlagIcon className="size-3.5" />
          </Button>

          {canRegenerate && (
            <>
              {/* Rewriting the prose is not an audio action and it is free, but it is gated
                  the same way: the edit is what a later regeneration would speak. */}
              <Button
                variant="ghost"
                size="icon"
                title="Rewrite this line's text"
                aria-label={`Edit the text of ${line.name}`}
                onClick={() => onEditText(line)}
              >
                <PencilIcon className="size-3.5" />
              </Button>

              {/* Only once there is something to go back to, so an untouched line keeps a
                  single control rather than two. */}
              {restorable && (
                <Button
                  variant="ghost"
                  size="icon"
                  title="Restore an earlier take (free)"
                  aria-label={`Restore an earlier take of ${line.name}`}
                  onClick={() => onRestore(line)}
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              )}

              <RegenerateButton
                busy={state?.phase === "busy"}
                blocked={null}
                onClick={() => onRegenerate(line)}
              />
            </>
          )}
        </span>
      </td>
    </tr>
  );
}
