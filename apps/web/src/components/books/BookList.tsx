"use client";

import { useMemo } from "react";

import { PageRow, type RowState } from "@/components/books/PageRow";
import type { ResultLine } from "@/lib/books/search";

/**
 * The results, as a table whose first two columns belong to the book rather than the page.
 *
 * Same shape as the other two explorers -- fixed layout, a header row, one row per line --
 * with the difference these lines actually have: a page is only half-meaningful without the
 * book around it, so the title and what opens it are written once and span the pages
 * beneath, the way the zones table reads as one zone rather than the same word forty times.
 */
type Props = {
  lines: ResultLine[];
  current: ResultLine | null;
  canRegenerate: boolean;
  rowStates: Record<string, RowState>;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  /** Narrowing to one book, from its name. */
  onSelectBook: (line: ResultLine) => void;
  /** Open the report dialog. Everyone gets this, signed in or not. */
  onReport: (line: ResultLine) => void;
  /** An earlier take is live again. */
  onRestored: (line: ResultLine, version: number) => void;
  /** Say a take is fine as it stands, despite a pronunciation having moved under it. */
  onClearDirty: (line: ResultLine) => void;
};

/**
 * How many rows each book occupies here, against the line that starts its run.
 *
 * Counted over the rows actually being drawn, never from `pageCount`: a filter can show
 * three pages of a twenty-page journal, and paging can split a book across two screens. A
 * rowspan longer than the rows under it pushes every following row one column to the right,
 * which is the whole table sliding sideways from one number being taken on trust.
 *
 * The search orders by title then book then page, so a book's rows are contiguous and this
 * is a walk rather than a grouping pass.
 */
export function bookRuns(lines: ResultLine[]): Map<string, number> {
  const sizes = new Map<string, number>();

  for (let i = 0; i < lines.length; ) {
    let end = i;
    while (end < lines.length && lines[end].bookId === lines[i].bookId) end++;
    sizes.set(lines[i].id, end - i);
    i = end;
  }

  return sizes;
}

export function BookList({
  lines,
  current,
  canRegenerate,
  rowStates,
  onPlay,
  onRegenerate,
  onSelectBook,
  onClearDirty,
  onReport,
  onRestored,
}: Props) {
  const groupRows = useMemo(() => bookRuns(lines), [lines]);

  return (
    // Fixed layout, because the point of the columns is that they line up down the page:
    // left to auto sizing, one long book title would widen its column for every row.
    <table className="w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-44" />
        <col className="w-32" />
        <col className="w-16" />
        {/* The text column takes whatever the named ones leave, which is what anyone here
            to read came for. */}
        <col />
        <col className="w-28" />
        <col className="w-16" />
        {/* Wide enough for what the cell actually holds, now that the controls sit on one
            line: icon buttons are 32px and an editor can have three side by side -- report,
            clear the pronunciation mark, regenerate. Anything narrower and they overflow
            left across the character count. w-10 for everyone else, who has the report
            button alone; never w-0, because the column still has to exist for the rowspans
            above it to count against. */}
        <col className={canRegenerate ? "w-28" : "w-10"} />
      </colgroup>
      <thead>
        <tr className="text-muted-foreground border-border border-b text-left text-xs">
          <th className="px-2 pb-1 font-medium">Book</th>
          <th className="px-2 pb-1 font-medium">Source</th>
          <th className="px-2 pb-1 font-medium">Page</th>
          <th className="px-2 pb-1 font-medium">Text</th>
          <th className="px-2 pb-1 font-medium">Audio</th>
          <th className="px-2 pb-1 text-right font-medium">Chars</th>
          <th className="sr-only">Actions</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <PageRow
            key={line.id}
            line={line}
            current={current?.id === line.id}
            canRegenerate={canRegenerate}
            groupRows={groupRows.get(line.id) ?? 0}
            state={rowStates[line.id]}
            onPlay={onPlay}
            onRegenerate={onRegenerate}
            onSelectBook={onSelectBook}
            onClearDirty={onClearDirty}
            onReport={onReport}
            onRestored={onRestored}
          />
        ))}
      </tbody>
    </table>
  );
}
