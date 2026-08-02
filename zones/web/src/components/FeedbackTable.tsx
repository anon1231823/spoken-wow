"use client";

import Link from "next/link";
import { useState } from "react";

import { FeedbackStatus } from "@/components/FeedbackStatus";
import { CATEGORY_LABEL, reporterLabel, type FeedbackReport, type Status } from "@/lib/feedback";
import { cn } from "@/lib/utils";

/**
 * The triage list: every report, newest first.
 *
 * Built on UserTable's shape -- the compact admin table this app already has -- rather
 * than on the explorer's, which is a fixed-layout table tuned for a thousand rows and a
 * keyboard.
 *
 * Rows are updated in place rather than by router.refresh(), unlike UserTable. Working
 * through a filtered list is the point of this page, and with ?status=open a refresh
 * would delete each row from under the cursor the moment it was answered -- the same
 * trap Explorer avoids by overlaying flags instead of refetching.
 */

/** A report, plus what the server resolved its lineId to. */
export type FeedbackRow = FeedbackReport & {
  /** The line's display name, or null for feedback about the project. */
  lineName: string | null;
  zoneName: string | null;
  mapID: number | null;
};

export function FeedbackTable({ rows }: { rows: FeedbackRow[] }) {
  const [reports, setReports] = useState(rows);

  function changed(id: number, status: Status, resolverEmail: string | null) {
    setReports((current) =>
      current.map((row) => (row.id === id ? { ...row, status, resolverEmail } : row)),
    );
  }

  if (reports.length === 0) {
    return <p className="py-8 text-center text-muted">No feedback here.</p>;
  }

  return (
    <table className="w-full">
      <thead className="text-left text-xs text-faint">
        <tr className="border-b border-border">
          <th className="py-2 pr-3 font-normal">Date</th>
          <th className="py-2 pr-3 font-normal">Line</th>
          <th className="py-2 pr-3 font-normal">Category</th>
          <th className="py-2 pr-3 font-normal">Feedback</th>
          <th className="py-2 pr-3 font-normal">From</th>
          <th className="py-2 font-normal">Status</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((report) => (
          <tr
            key={report.id}
            className={cn(
              "border-b border-border align-top last:border-0",
              report.status !== "open" && "opacity-60",
            )}
          >
            <td className="py-2 pr-3 whitespace-nowrap text-muted">
              {report.createdAt.slice(0, 10)}
            </td>

            <td className="py-2 pr-3">
              {report.mapID === null ? (
                // Feedback about the project belongs to no line, and linking it into a
                // filtered explorer would be linking to nothing.
                <span className="text-faint">— general</span>
              ) : (
                <Link
                  href={`/?zone=${report.mapID}&q=${encodeURIComponent(report.lineName ?? "")}`}
                  className="hover:text-accent hover:underline"
                  title={report.zoneName ?? undefined}
                >
                  {report.lineName}
                </Link>
              )}
            </td>

            <td className="py-2 pr-3 whitespace-nowrap text-muted">
              {CATEGORY_LABEL[report.category]}
            </td>

            <td className="py-2 pr-3 whitespace-pre-wrap">{report.body}</td>

            <td className="py-2 pr-3 text-muted">
              {reporterLabel(report)}
              {report.resolverEmail && (
                <span className="block text-xs text-faint">closed by {report.resolverEmail}</span>
              )}
            </td>

            <td className="py-2">
              <FeedbackStatus report={report} onChanged={changed} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
