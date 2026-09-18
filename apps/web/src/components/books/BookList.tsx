"use client";

import { Fragment } from "react";

import { PageRow, type RowState } from "@/components/books/PageRow";
import type { ResultLine } from "@/lib/books/search";

/**
 * The results, grouped under the book each page belongs to.
 *
 * A flat table of 1191 pages would be the wrong shape for what these lines are: a page is
 * only half-meaningful without the book around it, and "page 14" on its own says nothing.
 * The search already orders by title and page number, so grouping here is a walk rather
 * than a sort -- and a group header only appears where the book changes.
 */
type Props = {
  lines: ResultLine[];
  current: ResultLine | null;
  canRegenerate: boolean;
  rowStates: Record<string, RowState>;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  /** Narrowing to one book, from its header. */
  onSelectBook: (line: ResultLine) => void;
};

export function BookList({
  lines,
  current,
  canRegenerate,
  rowStates,
  onPlay,
  onRegenerate,
  onSelectBook,
}: Props) {
  return (
    <table className="w-full table-fixed text-sm">
      <tbody>
        {lines.map((line, index) => {
          const first = index === 0 || lines[index - 1].bookId !== line.bookId;

          return (
            <Fragment key={line.id}>
              {first && (
                <tr className="bg-muted/40">
                  <td colSpan={5} className="px-2 py-1.5">
                    <button
                      className="hover:text-foreground text-left font-medium underline-offset-2 hover:underline"
                      title={`Show only ${line.title}`}
                      onClick={() => onSelectBook(line)}
                    >
                      {line.title}
                    </button>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {line.ownerKind === "object" ? "in the world" : "carried"} ·{" "}
                      {line.pageCount === 1 ? "1 page" : `${line.pageCount} pages`} ·{" "}
                      {line.ownerIds.length === 1
                        ? `id ${line.ownerIds[0]}`
                        : `${line.ownerIds.length} sources`}
                    </span>
                  </td>
                </tr>
              )}

              <PageRow
                line={line}
                current={current?.id === line.id}
                canRegenerate={canRegenerate}
                state={rowStates[line.id]}
                onPlay={onPlay}
                onRegenerate={onRegenerate}
              />
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
