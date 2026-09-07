"use client";

import { useEffect, useState } from "react";

import { FeedbackStatus } from "@/components/FeedbackStatus";
import { CATEGORY_LABEL, reporterLabel, type FeedbackReport } from "@/lib/feedback";
import { useLang } from "@/lib/use-lang";
import { cn } from "@/lib/utils";

/**
 * Every report on one line, shown inside the expanded row.
 *
 * Fetched on expand rather than shipped with the search results, because the bodies are
 * triager-only and /api/search is public. What travels with the results is the open
 * COUNT, which is what the badge that opens this panel is drawn from.
 */

type Props = { lineId: string };

export function FeedbackPanel({ lineId }: Props) {
  // Reports are per language (migration 0010): the ones shown are about the text
  // and narration this page is reading.
  const { lang } = useLang();
  const [reports, setReports] = useState<FeedbackReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReports(null);
    setError(null);

    fetch(`/api/feedback?lineId=${encodeURIComponent(lineId)}&lang=${lang}`, {
      signal: controller.signal,
    })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("Could not load feedback.")),
      )
      .then((data: { reports: FeedbackReport[] }) => setReports(data.reports))
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      });

    return () => controller.abort();
  }, [lineId, lang]);

  if (error) return <p className="py-2 text-bad">{error}</p>;
  if (!reports) return <p className="py-2 text-faint">loading…</p>;
  if (reports.length === 0) return <p className="py-2 text-faint">No feedback on this line.</p>;

  return (
    <ul className="space-y-2 py-2">
      {reports.map((report) => (
        <li
          key={report.id}
          className={cn(
            "rounded border border-border p-2",
            // A closed report is still worth reading -- it is how a triager tells "nobody
            // has looked at this" from "we decided it was fine" -- but it should not
            // compete with the open ones for attention.
            report.status !== "open" && "opacity-60",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-faint">
            <span className="rounded bg-panel-hover px-1.5 py-0.5 text-fg">
              {CATEGORY_LABEL[report.category]}
            </span>
            <span>{new Date(report.createdAt).toISOString().slice(0, 10)}</span>
            <span>{reporterLabel(report)}</span>
            {report.resolverEmail && <span>closed by {report.resolverEmail}</span>}
            <span className="ml-auto">
              <FeedbackStatus
                report={report}
                onChanged={(id, status, resolverEmail) =>
                  setReports((current) =>
                    (current ?? []).map((r) =>
                      r.id === id ? { ...r, status, resolverEmail } : r,
                    ),
                  )
                }
              />
            </span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap">{report.body}</p>
        </li>
      ))}
    </ul>
  );
}
