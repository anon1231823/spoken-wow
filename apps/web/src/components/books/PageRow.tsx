"use client";

import { ChevronDownIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import RegenerateButton from "@/components/RegenerateButton";
import { materialName } from "@/lib/books/filters";
import type { ResultLine } from "@/lib/books/search";
import { cn } from "@/lib/utils";

export type RowState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

type Props = {
  line: ResultLine;
  current: boolean;
  /** Editor and up: the regenerate control. */
  canRegenerate: boolean;
  state?: RowState;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
};

// The same colour discipline as the other two explorers: red is only ever a real problem,
// amber is something that has drifted, grey is a fact about the row.
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

export function PageRow({ line, current, canRegenerate, state, onPlay, onRegenerate }: Props) {
  const playable = line.state !== "missing";
  const [expanded, setExpanded] = useState(false);

  /**
   * Clicking the row shows the whole page, but only when the click meant that.
   *
   * Two things it must not swallow: a click that landed on a control is that control's
   * business, and a click ending a drag over the prose is somebody copying it -- which is
   * half of what this cell is for on a page of a book.
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
      <td className="text-muted-foreground w-20 px-2 py-2 text-xs whitespace-nowrap">
        {line.pageCount > 1 ? `page ${line.pageNumber}/${line.pageCount}` : "single page"}
      </td>

      {/* The prose is plain markup rather than a button's label, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied.
          That is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          <button
            aria-current={current}
            disabled={!playable}
            onClick={() => onPlay(line)}
            title={playable ? `${line.file}.mp3` : undefined}
            aria-label={`Play page ${line.pageNumber} of ${line.title}`}
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

          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "clamp-2")}>
            {line.text}
          </span>

          {/* The regeneration outcome replaces the state chip: once a page has just been
              made, "no audio" is stale and confusing rather than merely redundant. */}
          {state?.phase === "error" ? (
            <span className="text-destructive mt-0.5 max-w-[12rem] shrink-0 text-right text-xs">
              {state.message}
            </span>
          ) : state?.phase === "done" ? (
            <span className="mt-0.5 shrink-0 text-xs text-emerald-400">
              regenerated · v{state.version}
            </span>
          ) : !line.generatable ? (
            // Why this page is silent, rather than leaving it looking un-narrated. It is in
            // the corpus because the game has it.
            <span className="text-muted-foreground mt-0.5 shrink-0 text-xs italic">
              {line.skipReason}
            </span>
          ) : (
            STATE_LABEL[line.state] && (
              <span className={cn("mt-0.5 shrink-0 text-xs", STATE_STYLE[line.state])}>
                {STATE_LABEL[line.state]}
              </span>
            )
          )}

          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle
              needs a real control. It doubles as the only thing saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this page" : "Show the whole page"}
            title={expanded ? "Collapse" : "Show the whole page"}
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

      <td className="text-muted-foreground w-24 px-2 py-2 text-xs whitespace-nowrap">
        {materialName(line.material)}
      </td>

      <td className="text-muted-foreground w-16 px-2 py-2 text-right text-xs whitespace-nowrap">
        {line.chars}
      </td>

      <td className="w-10 px-2 py-2">
        {canRegenerate && (
          <RegenerateButton
            onClick={() => onRegenerate(line)}
            busy={state?.phase === "busy"}
            blocked={line.generatable ? null : `this page cannot be voiced: ${line.skipReason}`}
          />
        )}
      </td>
    </tr>
  );
}
