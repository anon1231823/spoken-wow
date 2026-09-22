"use client";

/**
 * The triage list.
 *
 * A table rather than a stack of cards: triage is a scan down a column - what is this
 * about, how old is it, has anybody answered it - and a card makes that scan a scroll. Every
 * cell is one line high for the same reason; a gossip id is a 32-character hash, and left to
 * wrap it makes its row three times the height of its neighbours.
 *
 * Never renders `ip`: it is the rate limiter's key and nothing else, and a triager reading a
 * stranger's address serves no purpose that reading their report does not.
 */
import { useLang } from "@/components/LangProvider";
import { localeHref } from "@/lib/lang";
import { Play } from "lucide-react";
import Link from "@/components/LocaleLink";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import FilterChip from "@/components/FilterChip";
import QuestsPlayer from "@/components/Player";
import ReportDetail from "@/components/ReportDetail";
import { Player as BooksPlayer } from "@/components/books/Player";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Player as ZonesPlayer } from "@/components/zones/Player";
import { explorerHref, reportHref, targetExplorerHref } from "@/lib/links";
import type { ResultLine as BookLine } from "@/lib/books/search";
import { searchPath, type SourceLine } from "@/lib/reports/detail";
import { CATEGORIES, STATUSES, CATEGORY_COLUMN, SOURCE_LABELS, STATUS_LABELS, type Category, type Report, type Status } from "@/lib/reports/reports";
import { applyResolutions } from "@/lib/reports/rows";
import type { ResultLine as QuestLine } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { ResultLine as ZoneLine } from "@/lib/zones/search";
import { SOURCES, type Source } from "@/lib/sections";

const STATUS_OPTIONS = STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

const SOURCE_OPTIONS = SOURCES.map((source) => ({
  value: source,
  label: SOURCE_LABELS[source],
}));

/** The complaint dropdown's options, in the order the report form offers them. */
const CATEGORY_OPTIONS = CATEGORIES.map((category) => ({
  value: category,
  label: CATEGORY_COLUMN[category],
}));

/** The day and the clock time, short enough to sit in a column. */
function when(at: string): string {
  return new Date(at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One line of one corpus. Reports from all three share this table and its player. */
function lineKey(source: Source, lineId: string): string {
  return `${source}:${lineId}`;
}

export default function ReportTable({
  initial,
  view,
  source,
  category,
  canRegenerate,
}: {
  initial: Report[];
  view: Status | "all";
  source: Source | "all";
  category: Category | "all";
  /** Whether this visitor may spend credits from the panel below a row. */
  canRegenerate: boolean;
}) {
  /**
   * What this session resolved, overlaid on the server's rows.
   *
   * NOT a copy of `initial`: the filters above are links, so switching one is a navigation
   * that re-renders this component with new rows. Seeding state from props ignored them,
   * and the table sat unchanged until somebody reloaded the page - which is the bug this
   * shape exists to make impossible. See lib/reports/rows.ts.
   */
  const router = useRouter();
  const lang = useLang();
  const [resolved, setResolved] = useState<Record<number, Report>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  /**
   * Lines looked up so far, by source and id. Undefined means "not asked yet", null means
   * the lookup came back with nothing - a report about a line the corpus has since dropped.
   *
   * Here rather than inside the expanded row, because the play button needs the same line
   * without the panel being open, and a second fetch for the same id would be a second
   * corpus lookup for the same answer.
   */
  const [lines, setLines] = useState<Record<string, SourceLine | null>>({});
  /** The line the transport bar is pointed at, or null before anything has been played. */
  const [playing, setPlaying] = useState<{ source: Source; lineId: string } | null>(null);
  /**
   * Bumped by every press of a play button, including a second press of the same one.
   *
   * The start cannot happen in the handler: before the first press there is no transport
   * bar on the page at all, so the <audio> the ref would point at does not exist yet and
   * the click did nothing until a second one arrived to find it mounted. An effect runs
   * after the commit that mounts it, and the counter is what makes replaying the line
   * already loaded a change the effect can see.
   */
  const [pressed, setPressed] = useState(0);
  /** Takes written in this session, so the player plays the new one rather than the cache. */
  const [versions, setVersions] = useState<Record<string, number>>({});

  // ONE <audio> for the page, handed to whichever section's adapter is showing. Starting a
  // line therefore stops the previous one with no bookkeeping - see AudioPlayer.
  const audio = useRef<HTMLAudioElement>(null);

  const load = useCallback(
    async (reportSource: Source, lineId: string): Promise<SourceLine | null> => {
      const key = lineKey(reportSource, lineId);
      let cached: SourceLine | null | undefined;
      // Read through a setState rather than off `lines`, which this callback closes over
      // stale: two rows expanded in the same tick would otherwise both fetch.
      setLines((current) => {
        cached = current[key];
        return current;
      });
      if (cached !== undefined) return cached;

      const response = await fetch(searchPath(reportSource, lineId, lang)).catch(() => null);
      const body = response?.ok
        ? ((await response.json().catch(() => null)) as { lines?: SourceLine[] } | null)
        : null;
      const line = body?.lines?.[0] ?? null;

      setLines((current) => ({ ...current, [key]: line }));
      return line;
    },
    [],
  );

  function toggle(report: Report) {
    if (!report.lineId) return;
    const next = open === report.id ? null : report.id;
    setOpen(next);
    if (next !== null) void load(report.source, report.lineId);
  }

  async function play(report: Report) {
    if (!report.lineId) return;
    const line = await load(report.source, report.lineId);
    if (!line) return;

    setPlaying({ source: report.source, lineId: report.lineId });
    setPressed((count) => count + 1);
  }

  useEffect(() => {
    if (pressed === 0) return;
    void audio.current?.play().catch(() => {});
  }, [pressed]);

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
    setResolved((current) => ({ ...current, [report.id]: report }));
  }

  /**
   * Move one filter and keep the other two.
   *
   * Undefined is "every one of them", which the URL spells `all` - the same word the page
   * parses back, so a hand-shortened link and a chip produce the same query.
   */
  function go(next: { view?: string; source?: string; category?: string }) {
    const params = new URLSearchParams({
      view: next.view ?? (("view" in next) ? "all" : view),
      source: next.source ?? (("source" in next) ? "all" : source),
      category: next.category ?? (("category" in next) ? "all" : category),
    });
    router.push(localeHref(lang, `/reports?${params}`));
  }

  const reports = applyResolutions(initial, resolved);
  const playingKey = playing ? lineKey(playing.source, playing.lineId) : null;
  const playingLine = playingKey === null ? null : (lines[playingKey] ?? null);
  const playingVersion = playingKey === null ? undefined : versions[playingKey];

  return (
    <>
      {/* Three dropdowns, the same control the explorers filter with. Each writes its value
          to the URL rather than to state, so a narrowed queue can be shared and reloaded and
          the back button undoes a filter change. An idle chip means "every one of them":
          /reports with nothing on it still opens on the open queue, which is why the status
          chip arrives filled. */}
      <nav className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip
          label="status"
          value={view === "all" ? undefined : view}
          options={STATUS_OPTIONS}
          onChange={(next) => go({ view: next })}
        />
        <FilterChip
          label="section"
          value={source === "all" ? undefined : source}
          options={SOURCE_OPTIONS}
          onChange={(next) => go({ source: next })}
        />
        <FilterChip
          label="complaint"
          value={category === "all" ? undefined : category}
          options={CATEGORY_OPTIONS}
          onChange={(next) => go({ category: next })}
        />
      </nav>

      {reports.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing here.</p>
      ) : (
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="border-b py-2 pr-3 font-normal">Filed</th>
              <th className="border-b py-2 pr-3 font-normal">Where</th>
              <th className="border-b py-2 pr-3 font-normal">Complaint</th>
              <th className="border-b py-2 pr-3 font-normal">What they said</th>
              <th className="border-b py-2 pr-3 font-normal">Status</th>
              <th className="border-b py-2 font-normal" />
            </tr>
          </thead>

          <tbody>
            {reports.map((report) => {
              const expanded = open === report.id;
              const key = report.lineId ? lineKey(report.source, report.lineId) : null;

              return [
                // Every cell is one line except the body, which is clamped to two, so the
                // row centres rather than aligning to a top edge that only one cell has.
                <tr key={report.id} className="align-middle [&>td]:border-b [&>td]:py-2 [&>td]:leading-5">
                  <td className="text-muted-foreground pr-3 text-xs whitespace-nowrap">
                    {when(report.createdAt)}
                  </td>

                  <td className="max-w-[20rem] pr-3 text-xs">
                    <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
                      <Badge variant="outline" className="shrink-0 py-0 leading-5">
                        {SOURCE_LABELS[report.source]}
                      </Badge>
                      {/* The explorer, narrowed to this line: where a triager works. A
                          report with no line id - a gossip NPC whose reporter never picked
                          one of the takes - narrows the explorer by its address instead.
                          The `/r/` page the reporter saw is the last fallback, for an
                          address no filter addresses. */}
                      {report.lineId ? (
                        <Link
                          href={explorerHref(report.source, report.lineId)}
                          title={report.lineId}
                          className="truncate font-mono underline-offset-2 hover:underline"
                        >
                          {report.lineId}
                        </Link>
                      ) : report.target ? (
                        <Link
                          href={
                            targetExplorerHref(report.source, report.target) ??
                            reportHref(report.source, report.target)
                          }
                          title={report.target}
                          className="text-muted-foreground truncate font-mono underline-offset-2 hover:underline"
                        >
                          {report.target}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground truncate">about the project</span>
                      )}
                    </div>
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">
                    {CATEGORY_COLUMN[report.category]}
                  </td>

                  <td className="max-w-md pr-3">
                    <p className={cn("whitespace-pre-wrap", !expanded && "line-clamp-2")}>
                      {report.body}
                    </p>
                    {report.name || report.email ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {[report.name, report.email].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </td>

                  <td className="pr-3 text-xs whitespace-nowrap">
                    {STATUS_LABELS[report.status]}
                  </td>

                  <td>
                    <div className="flex items-center justify-end gap-1">
                      {report.lineId ? (
                        <>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            title="Play this line"
                            aria-label="Play this line"
                            onClick={() => void play(report)}
                          >
                            <Play />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-expanded={expanded}
                            onClick={() => toggle(report)}
                          >
                            {expanded ? "Hide" : "Details"}
                          </Button>
                        </>
                      ) : null}

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
                  </td>
                </tr>,

                expanded && report.lineId && key ? (
                  <tr key={`${report.id}-detail`}>
                    <td colSpan={6} className="bg-muted/40 border-b">
                      <ReportDetail
                        source={report.source}
                        lineId={report.lineId}
                        line={lines[key]}
                        canRegenerate={canRegenerate}
                        onRegenerated={(version) =>
                          setVersions((current) => ({ ...current, [key]: version }))
                        }
                        onOverridden={(text) =>
                          setLines((current) => {
                            const known = current[key];
                            if (!known) return current;
                            return { ...current, [key]: { ...known, override: text } };
                          })
                        }
                      />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      )}

      {/* The transport bar the explorers use, with the adapter of whichever section the
          playing line belongs to. Drawn only once something has been played: a bar saying
          "nothing playing" over a triage list is a line of chrome that answers nothing. */}
      {playing && playingLine ? (
        <div className="fixed inset-x-0 bottom-0 z-40">
          {playing.source === "quests" ? (
            <QuestsPlayer
              ref={audio}
              line={playingLine as QuestLine}
              version={playingVersion}
            />
          ) : playing.source === "zones" ? (
            <ZonesPlayer
              audioRef={audio}
              line={playingLine as ZoneLine}
              version={playingVersion}
            />
          ) : (
            <BooksPlayer
              audioRef={audio}
              line={playingLine as BookLine}
              version={playingVersion}
            />
          )}
        </div>
      ) : null}
    </>
  );
}
