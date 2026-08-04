"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FeedbackDialog, type FeedbackTarget } from "@/components/FeedbackDialog";
import { LineRow, type RowState } from "@/components/LineRow";
import { LoreDialog } from "@/components/LoreDialog";
import { NoteDialog } from "@/components/NoteDialog";
import { Player } from "@/components/Player";
import { RegenerateDialog } from "@/components/RegenerateDialog";
import { RegenerationPanel } from "@/components/RegenerationPanel";
import { SearchBar } from "@/components/SearchBar";
import { useSession } from "@/lib/auth-client";
import type { LineFlag, ZoneFacet } from "@/lib/catalogue";
import { filterParams, filtersFromParams, PAGE_SIZE, type LineFilters } from "@/lib/filters";
import * as permissions from "@/lib/permissions";
import type { Batch, Quote } from "@/lib/regenerate";
import type { ResultLine, SearchResult } from "@/lib/search";
import * as echo from "@/lib/url-echo";

const DEBOUNCE_MS = 200;
const POLL_MS = 1_000;

export function Explorer({ zones }: { zones: ZoneFacet[] }) {
  const router = useRouter();
  const params = useSearchParams();

  // What this visitor may do, which is what the rest of this component draws from.
  //
  // Read here rather than passed down from a server component, for UserMenu's reason: a
  // session read in the layout would put a database round trip in front of every page
  // view. While it is still pending both are false, so the controls appear once rather
  // than appearing and being taken away.
  //
  // Every one of these is checked again in src/lib/authz.ts. Nothing below is an access
  // control; it decides what is worth drawing.
  const { data: session } = useSession();
  const role = session?.user.role;
  const canReview = permissions.canReview(role);
  const canRegenerate = permissions.canRegenerate(role);
  const canTriage = permissions.canTriageFeedback(role);

  // FILTERS ARE REBUILT FROM THE URL EVERY RENDER rather than held in state, so the
  // back button is a working undo for a filter change and a link carries the exact
  // view someone was looking at. This is the single most useful thing ported from
  // ../wow-voiceover/web/src/components/Explorer.tsx:102.
  const filters = useMemo<LineFilters>(() => filtersFromParams(params), [params]);
  const page = Math.max(1, Number(params.get("page")) || 1);

  const urlQuery = filters.q ?? "";
  const [query, setQuery] = useState(urlQuery);
  const pending = useRef<echo.Pending>([]);

  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<ResultLine | null>(null);
  // Flags set since this page was fetched, overlaid on the fetched rows. Re-running
  // the search after every keystroke of a review pass would reorder the table under
  // the cursor -- and with ?flag=unreviewed it would make each line vanish as it is
  // judged, moving the next one under the key you are about to press again.
  const [flagged, setFlagged] = useState<Record<string, LineFlag | null>>({});
  const [noteFor, setNoteFor] = useState<ResultLine | null>(null);
  const [editFor, setEditFor] = useState<ResultLine | null>(null);
  // Text rewritten since this page was fetched, overlaid like `flagged` and for the same
  // reason: re-running the search would reorder the table under the cursor, and with
  // ?state=stale the line just edited would vanish as it was saved.
  const [rewritten, setRewritten] = useState<Record<string, string>>({});
  const [reportFor, setReportFor] = useState<FeedbackTarget | null>(null);
  // One expansion at a time, mirroring `current`: the panel is a paragraph of prose to
  // read, and a table with six of them open is no longer a table.
  const [expanded, setExpanded] = useState<string | null>(null);

  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  // Bumped per line after a regeneration, to bust the browser's audio cache: the
  // filename does not change, so without this the old take keeps playing.
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [pendingBatch, setPendingBatch] = useState<{ label: string; quote: Quote; lineIds: string[] } | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  //----------------------------------------------------------------------------
  // URL
  //----------------------------------------------------------------------------

  const updateUrl = useCallback(
    (next: Record<string, string | number | undefined>) => {
      const merged = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined || value === "" || value === 0) merged.delete(key);
        else merged.set(key, String(value));
      }
      // Any change other than paging returns to page 1: staying on page 7 of a result
      // set that just became three pages long shows nothing and looks like a bug.
      if (!("page" in next)) merged.delete("page");
      router.replace(`/?${merged}`, { scroll: false });
    },
    [params, router],
  );

  // Held in a ref so a filter change mid-word does not restart the keystroke timer.
  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => {
      pending.current = echo.write(pending.current, query);
      updateUrlRef.current({ q: query });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, urlQuery]);

  // The URL catching up, or changing underneath us (back button, a pasted link).
  useEffect(() => {
    const { pending: rest, adopt } = echo.receive(pending.current, urlQuery);
    pending.current = rest;
    if (adopt) setQuery(urlQuery);
  }, [urlQuery]);

  const updateFilters = useCallback(
    (next: Partial<LineFilters>) => {
      const merged = { ...filters, ...next };
      const search = filterParams(merged);
      router.replace(search.size ? `/?${search}` : "/", { scroll: false });
    },
    [filters, router],
  );

  //----------------------------------------------------------------------------
  // Fetch
  //----------------------------------------------------------------------------

  // A string, not the object: memoising on object identity would refetch every render.
  const filterQuery = useMemo(() => filterParams(filters).toString(), [filters]);

  // Held in refs so refetch() -- called from a poll and from a completed regeneration
  // -- reads the current view without being rebuilt on every filter change, which
  // would restart the poll timer each time.
  const filterQueryRef = useRef(filterQuery);
  filterQueryRef.current = filterQuery;
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);

    const search = new URLSearchParams(filterQuery);
    if (page > 1) search.set("page", String(page));

    fetch(`/api/search?${search}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: SearchResult) => {
        setResult(data);
        // The fetched rows carry the flags as they now are, so the local overlay has
        // done its job and would only go stale from here.
        setFlagged({});
        // Collapse too. The expansion is keyed on a lineId, so a row left open across a
        // filter change would reattach to whichever line now holds that id -- or, worse,
        // stay open showing one line's reports under another line's row.
        setExpanded(null);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [filterQuery, page]);

  //----------------------------------------------------------------------------
  // Flags
  //----------------------------------------------------------------------------

  const setFlag = useCallback(
    (line: ResultLine, status: "bad" | "ok" | null, note?: string) => {
      // Optimistic: a review pass is one judgement per second and waiting for a round
      // trip before showing it makes the whole thing feel broken. A failure rolls the
      // row back rather than leaving the UI claiming something the database refused.
      const previous = flagged[line.id] ?? line.flag;
      setFlagged((current) => ({
        ...current,
        [line.id]:
          status === null
            ? null
            : { status, note: note ?? previous?.note ?? null, updatedAt: new Date().toISOString() },
      }));

      fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id, status, note: note ?? null }),
      })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("rejected"))))
        .then((data: { flag: LineFlag | null }) => {
          setFlagged((current) => ({ ...current, [line.id]: data.flag }));
        })
        .catch(() => {
          setFlagged((current) => ({ ...current, [line.id]: previous }));
        });
    },
    [flagged],
  );

  // The fetched row, with any judgement or rewrite made since it was fetched laid over
  // the top. A rewritten line is stale by definition -- the text no longer hashes to what
  // was spoken -- so the state moves with the text rather than waiting for a refetch.
  const withFlag = useCallback(
    (line: ResultLine): ResultLine => {
      let out = line;
      if (line.id in flagged) out = { ...out, flag: flagged[line.id] };
      if (line.id in rewritten) {
        const text = rewritten[line.id];
        out = {
          ...out,
          text,
          chars: text.length,
          state: out.state === "missing" ? "missing" : "stale",
        };
      }
      return out;
    },
    [flagged, rewritten],
  );

  //----------------------------------------------------------------------------
  // Regeneration
  //----------------------------------------------------------------------------

  const refetch = useCallback(() => {
    const search = new URLSearchParams(filterQueryRef.current);
    if (pageRef.current > 1) search.set("page", String(pageRef.current));
    fetch(`/api/search?${search}`)
      .then((response) => response.json())
      .then((data: SearchResult) => setResult(data))
      .catch(() => {});
  }, []);

  const regenerateOne = useCallback(
    (line: ResultLine) => {
      setRowStates((current) => ({ ...current, [line.id]: { phase: "busy" } }));

      fetch("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineIds: [line.id] }),
      })
        .then((response) => response.json())
        .then((data: { job?: { state: string; version?: number; error?: string }; error?: string }) => {
          const job = data.job;
          if (!job || job.state === "failed") {
            setRowStates((current) => ({
              ...current,
              [line.id]: { phase: "error", message: job?.error ?? data.error ?? "failed" },
            }));
            return;
          }
          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "done", version: job.version! },
          }));
          setVersions((current) => ({ ...current, [line.id]: job.version! }));
          refetch();
        })
        .catch((err) => {
          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "error", message: String(err.message ?? err) },
          }));
        });
    },
    [refetch],
  );

  // Quote first, always. The dialog is shown against a snapshot of the ids, not
  // against the live filter: the dialog can sit open while the search box keeps being
  // typed into, and spending on a set nobody was shown is the failure to avoid.
  const askToRegenerateAll = useCallback(() => {
    const lineIds = (result?.lines ?? []).map((line) => line.id);
    if (lineIds.length === 0) return;

    fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quote", lineIds }),
    })
      .then((response) => response.json())
      .then((quote: Quote) =>
        setPendingBatch({ label: `${quote.lines} lines on this page`, quote, lineIds }),
      )
      .catch(() => {});
  }, [result]);

  const startBatch = useCallback(() => {
    if (!pendingBatch) return;
    const { lineIds } = pendingBatch;
    setPendingBatch(null);

    fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineIds }),
    })
      .then((response) => response.json())
      .then((data: { batchId?: string }) => {
        if (data.batchId) setBatchId(data.batchId);
      })
      .catch(() => {});
  }, [pendingBatch]);

  // One process, so there is no cursor to keep and nothing to reconcile -- just ask
  // what the batch is doing until it stops doing it.
  useEffect(() => {
    if (!batchId) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const poll = () => {
      fetch(`/api/regenerate?batchId=${batchId}`)
        .then((response) => response.json())
        .then((data: { batch: Batch | null }) => {
          if (cancelled) return;
          setBatch(data.batch);
          if (data.batch && data.batch.finishedAt === null) {
            timer = setTimeout(poll, POLL_MS);
          } else {
            setBatchId(null);
            refetch();
          }
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, POLL_MS);
        });
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [batchId, refetch]);

  const restore = useCallback(
    (line: ResultLine) => {
      fetch(`/api/restore?lineId=${encodeURIComponent(line.id)}`)
        .then((response) => response.json())
        .then((data: { versions: number[] }) => {
          const newest = data.versions[0];
          if (newest === undefined) return;
          return fetch("/api/restore", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lineId: line.id, version: newest }),
          })
            .then((response) => response.json())
            .then((result: { version?: number }) => {
              if (result.version !== undefined) {
                setVersions((current) => ({ ...current, [line.id]: result.version! }));
              }
              refetch();
            });
        })
        .catch(() => {});
    },
    [refetch],
  );

  //----------------------------------------------------------------------------
  // Playback
  //----------------------------------------------------------------------------

  const play = useCallback((line: ResultLine) => {
    setCurrent(line);
    // The <audio> src follows `current`, so play only once React has committed it.
    queueMicrotask(() => void audio.current?.play().catch(() => {}));
  }, []);

  // This page only, deliberately: j at the bottom of page 3 loading page 4 and
  // starting playback is a surprise, and the pager is right there.
  const playable = useMemo(
    () => (result?.lines ?? []).filter((line) => line.state !== "missing"),
    [result],
  );

  const step = useCallback(
    (delta: number) => {
      if (playable.length === 0) return;
      const index = current ? playable.findIndex((line) => line.id === current.id) : -1;
      const next = Math.min(Math.max(index + delta, 0), playable.length - 1);
      play(playable[next]);
    },
    [current, play, playable],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Never steal a keystroke from something being typed into. With native form
      // controls, tagName plus isContentEditable covers it -- the reason
      // ../wow-voiceover also has to check closest('[role="combobox"]') is that its
      // shadcn Select trigger is a <button role="combobox">, which this app has none of.
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (typing) return;

      if (event.key === " ") {
        // preventDefault or the page also scrolls, and a focused row button also
        // activates.
        event.preventDefault();
        const el = audio.current;
        if (!el || !current) return;
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
      } else if (event.key === "j") {
        event.preventDefault();
        step(1);
      } else if (event.key === "k") {
        event.preventDefault();
        step(-1);
      } else if (
        // The review keys are gated with the buttons they mirror. Left ungated they would
        // be the one way a member could still write a flag -- a shortcut for a control
        // that is not on their screen, failing silently against a 403.
        canReview &&
        current &&
        (event.key === "f" || event.key === "g" || event.key === "u")
      ) {
        event.preventDefault();
        // f bad, g ok, u undo. Judging a line does NOT advance to the next one:
        // deciding and moving on are separate thoughts, and a combined key would make
        // a mistaken tap cost both a wrong verdict and a lost place.
        setFlag(current, event.key === "f" ? "bad" : event.key === "g" ? "ok" : null);
      } else if (canReview && current && event.key === "n") {
        event.preventDefault();
        setNoteFor(withFlag(current));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canReview, current, setFlag, step, withFlag]);

  // Keep the selected row visible when j/k walks off the bottom of the viewport.
  useEffect(() => {
    if (!current) return;
    document
      .querySelector(`[data-line-key="${CSS.escape(current.id)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  //----------------------------------------------------------------------------
  // Render
  //----------------------------------------------------------------------------

  const pages = result ? Math.max(1, Math.ceil(result.total / PAGE_SIZE)) : 1;

  // The one place the column count is computed. Keep it in step with <colgroup> and
  // <thead> below, and see the note on LineRow's colSpan prop for why it is not derived
  // there.
  const colSpan = canRegenerate ? 6 : 5;

  return (
    <div className="pb-24">
      <SearchBar
        zones={zones}
        filters={filters}
        canReview={canReview}
        query={query}
        inputRef={searchInput}
        onQueryChange={setQuery}
        onChange={updateFilters}
        onClearAll={() => router.replace("/", { scroll: false })}
      />

      <div className="shell flex items-center gap-4 py-2 text-muted">
        {result && (
          <>
            <span>
              <strong className="text-fg">{result.total.toLocaleString()}</strong> lines
            </span>
            <span className="text-faint">{result.totalChars.toLocaleString()} chars</span>
            {result.counts.missing > 0 && (
              <span className="text-bad">{result.counts.missing} missing</span>
            )}
            {result.counts.stale > 0 && (
              <span className="text-warn">{result.counts.stale} stale</span>
            )}
          </>
        )}
        {loading && <span className="text-faint">loading…</span>}

        {canRegenerate && result && result.total > 0 && (
          <button
            type="button"
            onClick={askToRegenerateAll}
            className="ml-auto rounded border border-border px-2 py-0.5 hover:bg-panel-hover hover:text-fg"
          >
            Regenerate this page…
          </button>
        )}
      </div>

      {/* The wrapper carries the column, not the table: see .shell-table in
          globals.css for why a collapsed table cannot carry it itself. */}
      <div className="shell shell-table">
        <table className="w-full table-fixed">
          {/* Two columns narrow or vanish for a visitor rather than being drawn empty:
              State keeps the missing/stale label but loses the three flag controls, and
              Audio is nothing but controls, so it goes. The width lands on Lore, which
              is the column anyone here to read is here for. */}
          <colgroup>
            <col className="w-36" />
            <col className="w-44" />
            <col className={canReview ? "w-40" : "w-28"} />
            <col />
            <col className="w-16" />
            {canRegenerate && <col className="w-28" />}
          </colgroup>
          <thead className="text-left text-xs text-faint">
            <tr className="border-b border-border">
              <th className="px-2 py-1 font-normal">Zone</th>
              <th className="px-2 py-1 font-normal">Subzone</th>
              <th className="px-2 py-1 font-normal">State</th>
              <th className="px-2 py-1 font-normal">Lore</th>
              <th className="px-2 py-1 text-right font-normal">Chars</th>
              {canRegenerate && <th className="px-2 py-1 text-right font-normal">Audio</th>}
            </tr>
          </thead>
          <tbody>
            {result?.lines.map((line) => (
              <LineRow
                key={line.id}
                line={withFlag(line)}
                current={line.id === current?.id}
                canReview={canReview}
                canRegenerate={canRegenerate}
                canTriage={canTriage}
                expanded={expanded === line.id}
                colSpan={colSpan}
                onPlay={play}
                onNarrowToZone={(l) => updateFilters({ mapID: l.mapID })}
                state={rowStates[line.id]}
                onFlag={setFlag}
                onNote={(l) => setNoteFor(withFlag(l))}
                onReport={setReportFor}
                onToggleExpand={(l) => setExpanded((open) => (open === l.id ? null : l.id))}
                onEditText={(l) => setEditFor(withFlag(l))}
                onRegenerate={regenerateOne}
                onRestore={restore}
              />
            ))}
          </tbody>
        </table>
      </div>

      {result && result.total === 0 && !loading && (
        <p className="shell py-8 text-center text-muted">Nothing matches these filters.</p>
      )}

      {pages > 1 && (
        <div className="shell flex items-center justify-center gap-4 py-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => updateUrl({ page: page - 1 })}
            className="rounded border border-border px-3 py-1 disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-muted">
            page {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => updateUrl({ page: page + 1 })}
            className="rounded border border-border px-3 py-1 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}

      <p className="shell pb-4 text-center text-xs text-faint">
        <kbd>/</kbd> search · <kbd>space</kbd> play/pause · <kbd>j</kbd>/<kbd>k</kbd> next/previous
        {canReview && (
          <>
            {" "}
            · <kbd>f</kbd> bad · <kbd>g</kbd> ok · <kbd>u</kbd> undo · <kbd>n</kbd> note
          </>
        )}
      </p>

      <NoteDialog
        line={noteFor}
        onClose={() => setNoteFor(null)}
        onSave={(line, note) => {
          setFlag(line, line.flag?.status ?? "bad", note);
          setNoteFor(null);
        }}
      />

      <LoreDialog
        line={editFor}
        onClose={() => setEditFor(null)}
        onSaved={(line, full) => setRewritten((current) => ({ ...current, [line.id]: full }))}
      />

      <FeedbackDialog target={reportFor} onClose={() => setReportFor(null)} />

      <RegenerateDialog
        pending={pendingBatch}
        onConfirm={startBatch}
        onCancel={() => setPendingBatch(null)}
      />

      {/* One stack, so the panel sits flush on top of a player of any height. */}
      <div className="fixed inset-x-0 bottom-0 z-30">
        <RegenerationPanel
          batch={batch}
          onStop={() => {
            if (!batch) return;
            void fetch("/api/regenerate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "stop", batchId: batch.id }),
            });
          }}
          onDismiss={() => setBatch(null)}
        />
        <Player
          line={current}
          version={current ? (versions[current.id] ?? current.take?.version) : undefined}
          audioRef={audio}
        />
      </div>
    </div>
  );
}
