"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ApiKeyRequiredDialog from "@/components/ApiKeyRequiredDialog";
import Key from "@/components/Key";
import Pagination from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import RegenerateDialog from "@/components/RegenerateDialog";
import RegenerationPanel from "@/components/RegenerationPanel";
import { LineRow, type RowState } from "@/components/zones/LineRow";
import { LoreDialog } from "@/components/zones/LoreDialog";
import { NoteDialog } from "@/components/zones/NoteDialog";
import { Player } from "@/components/zones/Player";
import ZoneReportDialog, { type ReportTarget } from "@/components/zones/ReportDialog";
import { SearchBar } from "@/components/zones/SearchBar";
import { useSession } from "@/lib/auth-client";
import { totals as estimateTotals, LIST_RATE, type Estimate } from "@/lib/generation/billing";
import {
  clearDirty,
  dismissQueue,
  fetchGenerationStatus,
  fetchQueue,
  queueBatch,
  stopQueue,
  type GenerationStatusResponse,
  type QueueSnapshot,
} from "@/lib/generation/client";
import { noApiKeyMessage } from "@/lib/no-api-key";
import * as permissions from "@/lib/permissions";
import type { LineFlag, ZoneFacet } from "@/lib/zones/catalogue";
import { filterParams, filtersFromParams, PAGE_SIZE, type LineFilters } from "@/lib/zones/filters";
import type { ResultLine, SearchResult } from "@/lib/zones/search";
import * as echo from "@/lib/url-echo";

// Long enough to hold a whole typed word: the timer restarts on every keystroke, so this
// is the pause after the last one, not a rate limit. Anyone who wants results before it
// elapses presses Enter, which fires the search immediately.
const DEBOUNCE_MS = 500;

export function Explorer({ zones }: { zones: ZoneFacet[] }) {
  const pathname = usePathname();
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
  // One role does all three here. The zones site had `editor` for reviewing and
  // regenerating and a separate triage permission; this app's `collaborator` is the same
  // person, and splitting a role that nobody had split by hand would be inventing a
  // distinction to maintain.
  const canReview = permissions.canRegenerate(role);
  const canRegenerate = permissions.canRegenerate(role);
  const canTriage = permissions.canRegenerate(role);

  // FILTERS ARE REBUILT FROM THE URL EVERY RENDER rather than held in state, so the
  // back button is a working undo for a filter change and a link carries the exact
  // view someone was looking at. This is the single most useful thing the two explorers
  // have in common; the quests one makes the same argument.
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
  const [reportFor, setReportFor] = useState<ReportTarget | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  // Bumped per line after a regeneration, to bust the browser's audio cache: the
  // filename does not change, so without this the old take keeps playing.
  const [versions, setVersions] = useState<Record<string, number>>({});
  /**
   * The batch waiting to be confirmed, with the ids it was quoted for.
   *
   * The ids are a snapshot rather than the live filter: the dialog can sit open while the
   * search box keeps being typed into, and spending on a set nobody was shown is the
   * failure to avoid.
   */
  const [pendingBatch, setPendingBatch] = useState<{
    label: string;
    estimate: Estimate;
    lineIds: string[];
  } | null>(null);

  // The shared queue, which both sections poll. A batch someone else started is spending
  // the same plan's credits, so it belongs on this screen too.
  const [queue, setQueue] = useState<QueueSnapshot | null>(null);
  const [queueNote, setQueueNote] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const cursor = useRef<string | null>(null);
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  // A refusal for want of a key, which is not a failure of the line and does not belong
  // in its row: the row would say "failed" for something the corpus had no part in.
  const [keyRequired, setKeyRequired] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);

  //----------------------------------------------------------------------------
  // URL
  //----------------------------------------------------------------------------

  // history.replaceState, not router.replace, and the current path rather than "/".
  //
  // Both halves of that were a page load per keystroke. The bare path is a redirect
  // route -- src/app/page.tsx sends it to /enUS -- so "/?q=..." cost a round trip, a
  // redirect and a re-render of the page's zoneFacets() on every debounce, and on
  // /deDE it threw the language away as well. router.replace() would still re-render
  // the server component for the query change alone.
  //
  // Nothing on this screen needs the server for a filter change: the rows come from
  // /api/search below, and Next re-renders useSearchParams() from a native history
  // call, so `filters` still rebuilds from the URL and the URL still carries the view.
  const replaceQuery = useCallback(
    (search: URLSearchParams) => {
      const query = search.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

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
      replaceQuery(merged);
    },
    [params, replaceQuery],
  );

  // Held in a ref so a filter change mid-word does not restart the keystroke timer.
  const updateUrlRef = useRef(updateUrl);
  updateUrlRef.current = updateUrl;

  const commitQuery = useCallback((value: string) => {
    pending.current = echo.write(pending.current, value);
    updateUrlRef.current({ q: value });
  }, []);

  // A debounce, not a throttle: the timer is cleared and restarted by every keystroke,
  // so a search runs DEBOUNCE_MS after typing stops rather than at a fixed cadence
  // through it.
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => commitQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commitQuery, query, urlQuery]);

  // Enter skips the wait. The effect above then sees query === urlQuery and stands down.
  const submitQuery = useCallback(() => {
    if (query !== urlQuery) commitQuery(query);
  }, [commitQuery, query, urlQuery]);

  // The URL catching up, or changing underneath us (back button, a pasted link).
  useEffect(() => {
    const { pending: rest, adopt } = echo.receive(pending.current, urlQuery);
    pending.current = rest;
    if (adopt) setQuery(urlQuery);
  }, [urlQuery]);

  const updateFilters = useCallback(
    (next: Partial<LineFilters>) => {
      const merged = { ...filters, ...next };
      replaceQuery(filterParams(merged));
    },
    [filters, replaceQuery],
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

    fetch(`/api/zones/search?${search}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data: SearchResult) => {
        setResult(data);
        // The fetched rows carry the flags as they now are, so the local overlay has
        // done its job and would only go stale from here.
        setFlagged({});
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

  // Files acknowledged since this page was fetched. Held here rather than refetched, for
  // the reason the flag overlay is: a search rebuild to unset one boolean is wasteful.
  const [cleared, setCleared] = useState<Set<string>>(new Set());

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

      fetch("/api/zones/flags", {
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
  /**
   * Say these takes are fine as they stand.
   *
   * Optimistic, like a flag: the mark disappears when the button is pressed and comes back
   * if the write is refused, because the alternative is a control that does nothing visible
   * for a round trip. Keyed on the file, which is what the acknowledgement is keyed on.
   */
  const clearDirtyFiles = useCallback((files: string[]) => {
    if (!files.length) return;
    setCleared((current) => new Set([...current, ...files]));
    void clearDirty("zones", files).then((ok) => {
      if (ok) return;
      setCleared((current) => {
        const next = new Set(current);
        for (const file of files) next.delete(file);
        return next;
      });
    });
  }, []);

  /** Every dirty line the current filter matches, not just this page's. */
  const clearAllDirty = useCallback(() => {
    fetch(`/api/zones/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`)
      .then((response) => response.json())
      .then(({ dirtyFiles }: { dirtyFiles?: string[] }) => clearDirtyFiles(dirtyFiles ?? []))
      .catch(() => {});
  }, [clearDirtyFiles]);

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
          // A save is a translation, whatever the row said before it was fetched.
          ...(out.translated === false ? { translated: true } : {}),
        };
      }
      // Cleared in this session. The row keeps whatever the search said about everything
      // else: an acknowledgement is about the pronunciation mark and nothing more.
      if (cleared.has(out.file)) out = { ...out, dirty: false };
      return out;
    },
    [flagged, rewritten, cleared],
  );

  //----------------------------------------------------------------------------
  // Regeneration
  //----------------------------------------------------------------------------

  const refetch = useCallback(() => {
    const search = new URLSearchParams(filterQueryRef.current);
    if (pageRef.current > 1) search.set("page", String(pageRef.current));
    fetch(`/api/zones/search?${search}`)
      .then((response) => response.json())
      .then((data: SearchResult) => setResult(data))
      .catch(() => {});
  }, []);

  // What the plan allows and what is left of it, for the confirmation dialog. Shared with
  // the quests section because it is one account and one budget.
  useEffect(() => {
    if (!canRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal).then(setStatus);
    return () => controller.abort();
  }, [canRegenerate]);

  /**
   * One line, awaited.
   *
   * Straight through without a quote: it is one click, it is cheap, and the archive makes
   * it reversible. Anything larger goes through the queue below.
   */
  const regenerateOne = useCallback(
    (line: ResultLine) => {
      setRowStates((current) => ({ ...current, [line.id]: { phase: "busy" } }));

      fetch("/api/zones/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: line.id }),
      })
        .then(async (response) => {
          const data = (await response.json().catch(() => ({}))) as {
            ok?: boolean;
            version?: number;
            error?: string;
            code?: string;
          };

          // Nothing was attempted and nothing was billed, so the row goes back to how it
          // was rather than wearing an error for a piece of missing setup.
          const needsKey = noApiKeyMessage(response.status, data);
          if (needsKey) {
            setKeyRequired(needsKey);
            setRowStates((current) => {
              const { [line.id]: _dropped, ...rest } = current;
              return rest;
            });
            return;
          }

          if (!response.ok || !data.ok || data.version === undefined) {
            setRowStates((current) => ({
              ...current,
              [line.id]: { phase: "error", message: data.error ?? "failed" },
            }));
            return;
          }

          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "done", version: data.version! },
          }));
          setVersions((current) => ({ ...current, [line.id]: data.version! }));
          refetch();
        })
        .catch((err: Error) => {
          setRowStates((current) => ({
            ...current,
            [line.id]: { phase: "error", message: String(err.message ?? err) },
          }));
        });
    },
    [refetch],
  );

  /**
   * Quote first, always.
   *
   * The ids cover every page the filter matches, fetched at click time, and the estimate is
   * computed from them here rather than asked for: the characters are already on screen,
   * and the rate is the plan's, which /api/generation/status already carries. The zones
   * site had a quote endpoint because its cost model lived in config.json; both sections
   * read one rate now, calibrated from what this account has actually been charged.
   */
  const askToRegenerateAll = useCallback(() => {
    if (!result || result.total === 0) return;

    fetch(`/api/zones/search?${new URLSearchParams(filterQueryRef.current)}&ids=1`)
      .then((response) => response.json())
      .then(({ ids, totalChars }: { ids: string[]; totalChars: number }) => {
        if (ids.length === 0) return;
        const rate = status?.rate ?? { rate: LIST_RATE, samples: 0, modelId: null };
        setPendingBatch({
          label: `all ${ids.length.toLocaleString()} filtered lines`,
          // Lines and files are the same count here: naming.mjs gives every line a file of
          // its own. The quests side has to tell them apart because 1,076 of its files are
          // spoken by more than one NPC.
          estimate: estimateTotals(
            { lines: ids.length, files: ids.length, characters: totalChars },
            rate,
          ),
          lineIds: ids,
        });
      })
      .catch(() => {});
  }, [result, status]);

  /**
   * Hand the batch to the queue.
   *
   * The ids are the ones the estimate was built from, so what is queued is what was
   * quoted. They come from `pendingBatch` rather than from the live search for the reason
   * the snapshot exists at all.
   */
  const startBatch = useCallback(async () => {
    if (!pendingBatch) return;
    const { lineIds } = pendingBatch;
    setPendingBatch(null);
    setDismissed(false);
    setQueueNote(null);

    const queued = await queueBatch({ source: "zones", lineIds }, pendingBatch.label);

    if (!queued) {
      // No reason offered because none was given: the route refused for a cause this
      // response does not carry, and inventing one would be a guess dressed as an answer.
      setQueueNote("Could not queue the batch.");
    } else if ("error" in queued) {
      setKeyRequired(queued.error);
    } else if (queued.skipped > 0) {
      setQueueNote(`${queued.skipped.toLocaleString()} already queued`);
    }

    const snapshot = await fetchQueue(cursor.current);
    if (snapshot) {
      cursor.current = snapshot.cursor;
      setQueue(snapshot);
    }
  }, [pendingBatch]);

  /**
   * The queue, polled.
   *
   * Two seconds while there is work and fifteen while there is not, so an idle page is not
   * asking a database forty times a minute for the same empty answer. Every take that
   * landed since the last poll is adopted here, which is what makes another collaborator's
   * work show up on this page -- and what replaced the zones site's own poll, which could
   * only ever see a batch its own process was running.
   */
  useEffect(() => {
    if (!canRegenerate) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    // Kept outside state so a dropped poll has something to fall back on: a null response
    // means the network hiccuped, not that the batch finished, and dropping to the idle
    // pace would leave the panel stale for fifteen seconds of a batch someone is watching.
    let active = false;
    const controller = new AbortController();

    async function poll() {
      const snapshot = await fetchQueue(cursor.current, controller.signal);
      if (cancelled) return;

      if (snapshot) {
        active = snapshot.active;
        cursor.current = snapshot.cursor;
        setQueue(snapshot);

        // Only this section's finished jobs. The queue carries both, and a zones page told
        // that a quests file is now at version 3 would look for a line it does not have.
        const mine = snapshot.finished.filter((job) => job.source === "zones");
        if (mine.length > 0) {
          setVersions((current) => {
            const next = { ...current };
            for (const job of mine) next[job.lineId] = job.version;
            return next;
          });
          refetch();
        }
        if (snapshot.active) setDismissed(false);
      }

      timer = setTimeout(poll, active ? 2_000 : 15_000);
    }

    void poll();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [canRegenerate, refetch]);

  const restore = useCallback(
    (line: ResultLine) => {
      fetch(`/api/zones/restore?${new URLSearchParams({ lineId: line.id })}`)
        .then((response) => response.json())
        .then((data: { versions: number[] }) => {
          const newest = data.versions[0];
          if (newest === undefined) return;
          return fetch("/api/zones/restore", {
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

  return (
    <div className="pb-24">
      <SearchBar
        zones={zones}
        filters={filters}
        canReview={canReview}
        query={query}
        inputRef={searchInput}
        onQueryChange={setQuery}
        onQuerySubmit={submitQuery}
        onChange={updateFilters}
        onClearAll={() => replaceQuery(new URLSearchParams())}
      />

      {/* A line id has no dropdown to sit in - it arrives by link from /reports - so
          without this the list would be narrowed with nothing on the page saying so. */}
      {filters.line && (
        <div className="text-muted-foreground mt-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs">
          <span>
            Showing one line: <span className="font-mono">{filters.line}</span>
          </span>
          <Button size="sm" variant="ghost" onClick={() => updateFilters({ line: undefined })}>
            Show everything
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 pb-1">
        <div className="text-muted-foreground text-sm">
          {loading && !result
            ? "Searching…"
            : result
              ? `${result.total.toLocaleString()} ${result.total === 1 ? "line" : "lines"}`
              : ""}
        </div>
        {result && result.counts.missing > 0 && (
          <span className="text-destructive text-sm">{result.counts.missing} missing</span>
        )}
        {result && result.counts.stale > 0 && (
          <span className="text-sm text-amber-300">{result.counts.stale} outdated</span>
        )}
        {/* Its own count, beside the states rather than among them: a line can be current
            and carry this at once. The button only for someone who could act on it. */}
        {result && result.dirty > 0 && (
          <span className="flex items-center gap-1 text-sm text-amber-300">
            {result.dirty} pronunciation
            {canRegenerate && (
              <Button size="xs" variant="ghost" onClick={clearAllDirty}>
                clear all
              </Button>
            )}
          </span>
        )}

        {canRegenerate && result && result.total > 0 && (
          <Button size="xs" variant="secondary" className="ml-auto" onClick={askToRegenerateAll}>
            Regenerate all {result.total.toLocaleString()}
          </Button>
        )}
      </div>

      {/* Above the table as well as below it: 43 pages of lore is a lot of scrolling to
          reach a control that is one line away at the top. */}
      <Pagination page={page} pageCount={pages} onPage={(next) => updateUrl({ page: next })} />

      {/* Fixed layout, because the point of the columns is that they line up down the
          page: left to auto sizing, one long subzone name would widen its column for
          every row. The lore column takes whatever the named ones leave. */}
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-40" />
          <col className="w-44" />
          <col />
          {/* The review column narrows for a visitor rather than being drawn empty: it
              keeps the verdict badge and the report count, and loses the three controls.
              The width lands on Lore, which is what anyone here to read came for. */}
          <col className={canReview ? "w-40" : "w-20"} />
          {/* Wide enough for what the cell actually holds: icon buttons are 32px, an editor
              can have four side by side - report, edit, restore, regenerate - and the take
              version sits in front of them. Anything narrower and the row overflows left
              over the prose. w-10 for everyone else, who has the report button and nothing
              more; never w-0, since that button is not gated. */}
          <col className={canRegenerate ? "w-48" : "w-10"} />
        </colgroup>
        <thead>
          <tr className="text-muted-foreground border-border border-b text-left text-xs">
            <th className="px-2 pb-1 font-medium">Zone</th>
            <th className="px-2 pb-1 font-medium">Subzone</th>
            <th className="px-2 pb-1 font-medium">Lore</th>
            <th className="px-2 pb-1 font-medium">Review</th>
            <th className="sr-only">Actions</th>
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
              onPlay={play}
              onNarrowToZone={(l) => updateFilters({ mapID: l.mapID })}
              state={rowStates[line.id]}
              onFlag={setFlag}
              onClearDirty={(l) => clearDirtyFiles([l.file])}
              onNote={(l) => setNoteFor(withFlag(l))}
              onReport={(l) =>
                setReportFor({ lineId: l.id, file: l.file, name: l.name })
              }
              onEditText={(l) => setEditFor(withFlag(l))}
              onRegenerate={regenerateOne}
              onRestore={restore}
            />
          ))}
        </tbody>
      </table>

      {result && result.total === 0 && !loading && (
        <p className="text-muted-foreground py-8 text-center">Nothing matches these filters.</p>
      )}

      <Pagination page={page} pageCount={pages} onPage={(next) => updateUrl({ page: next })} />

      <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
        <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next and
        previous line on this page
        {canReview && (
          <>
            {" "}
            · <Key>f</Key> bad · <Key>g</Key> ok · <Key>u</Key> undo · <Key>n</Key> note
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

      <ZoneReportDialog target={reportFor} onClose={() => setReportFor(null)} />

      <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />

      <RegenerateDialog
        pending={pendingBatch}
        status={status}
        onConfirm={() => void startBatch()}
        onCancel={() => setPendingBatch(null)}
      />

      {/* One stack, so the panel sits flush on top of a player of any height. */}
      <div className="fixed inset-x-0 bottom-0 z-30">
        <RegenerationPanel
          queue={queue}
          note={dismissed ? null : queueNote}
          onStop={() => void stopQueue()}
          onDismiss={() => {
            setDismissed(true);
            setQueueNote(null);
            // Only what the panel was showing is dismissed: the cursor is the high-water
            // mark of what this page has seen, so work that lands afterwards reappears.
            if (cursor.current) void dismissQueue(cursor.current);
          }}
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
