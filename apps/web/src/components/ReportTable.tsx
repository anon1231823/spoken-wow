"use client";

/**
 * The triage list.
 *
 * Never renders `ip`: it is the rate limiter's key and nothing else, and a triager reading a
 * stranger's address serves no purpose that reading their report does not.
 */
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CATEGORY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  type Report,
  type Source,
  type Status,
} from "@/lib/reports/reports";

const VIEWS: { value: Status | "all"; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "fixed", label: "Fixed" },
  { value: "not_an_issue", label: "Not a problem" },
  { value: "all", label: "All" },
];

const SOURCE_VIEWS: { value: Source | "all"; label: string }[] = [
  { value: "all", label: "Both" },
  { value: "quests", label: "Quests" },
  { value: "zones", label: "Zones" },
];

/**
 * Where a line of each corpus is browsed.
 *
 * A map rather than one path, because the two explorers are two pages. The zones one arrives
 * with the port; until then no report carries that source, so nothing links there.
 */
const EXPLORER: Record<Source, string> = {
  quests: "/",
  zones: "/zones",
};

export default function ReportTable({
  initial,
  view,
  source,
}: {
  initial: Report[];
  view: Status | "all";
  source: Source | "all";
}) {
  const [reports, setReports] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);

  async function resolve(id: number, status: Status) {
    setBusy(id);
    const response = await fetch("/api/reports/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => null);
    setBusy(null);

    if (!response?.ok) return;

    const { report } = (await response.json()) as { report: Report };
    setReports((current) => current.map((row) => (row.id === report.id ? report : row)));
  }

  return (
    <>
      {/* Links rather than client state, so a view can be shared and reloaded. */}
      <nav className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        {VIEWS.map((option) => (
          <Link
            key={option.value}
            href={`/reports?view=${option.value}&source=${source}`}
            className={option.value === view ? "font-semibold" : "text-muted-foreground"}
          >
            {option.label}
          </Link>
        ))}

        <span aria-hidden className="text-muted-foreground">
          |
        </span>

        {SOURCE_VIEWS.map((option) => (
          <Link
            key={option.value}
            href={`/reports?view=${view}&source=${option.value}`}
            className={option.value === source ? "font-semibold" : "text-muted-foreground"}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : null}

      <ul className="flex flex-col gap-4">
        {reports.map((report) => (
          <li key={report.id} className="rounded border p-4">
            <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
              <Badge variant="outline">{SOURCE_LABELS[report.source]}</Badge>
              <span>{new Date(report.createdAt).toLocaleString()}</span>
              <span>{CATEGORY_LABELS[report.category]}</span>
              <span>{STATUS_LABELS[report.status]}</span>
              {/* Null where the source has no addresses of its own to record. */}
              {report.target ? <span className="font-mono">{report.target}</span> : null}
              {report.lineId ? (
                <Link
                  href={`${EXPLORER[report.source]}?q=${encodeURIComponent(report.lineId)}`}
                  className="font-mono underline-offset-2 hover:underline"
                >
                  {report.lineId}
                </Link>
              ) : (
                <span>unresolved</span>
              )}
            </div>

            <p className="mt-2 text-sm whitespace-pre-wrap">{report.body}</p>

            {report.name || report.email ? (
              <p className="text-muted-foreground mt-1 text-xs">
                {[report.name, report.email].filter(Boolean).join(" · ")}
              </p>
            ) : null}

            <div className="mt-3 flex gap-2">
              {report.status === "open" ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === report.id}
                    onClick={() => resolve(report.id, "fixed")}
                  >
                    Fixed
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === report.id}
                    onClick={() => resolve(report.id, "not_an_issue")}
                  >
                    Not a problem
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === report.id}
                  onClick={() => resolve(report.id, "open")}
                >
                  Reopen
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
