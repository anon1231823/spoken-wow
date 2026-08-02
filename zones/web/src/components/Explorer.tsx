"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LineRow } from "@/components/LineRow";
import { NoteDialog } from "@/components/NoteDialog";
import { Player } from "@/components/Player";
import { SearchBar } from "@/components/SearchBar";
import type { LineFlag, ZoneFacet } from "@/lib/catalogue";
import { filterParams, filtersFromParams, PAGE_SIZE, type LineFilters } from "@/lib/filters";
import type { ResultLine, SearchResult } from "@/lib/search";
import * as echo from "@/lib/url-echo";

const DEBOUNCE_MS = 200;

export function Explorer({ zones }: { zones: ZoneFacet[] }) {
  const router = useRouter();
  const params = useSearchParams();

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

  // The fetched row, with any judgement made since it was fetched laid over the top.
  const withFlag = useCallback(
    (line: ResultLine): ResultLine =>
      line.id in flagged ? { ...line, flag: flagged[line.id] } : line,
    [flagged],
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
      } else if (current && (event.key === "f" || event.key === "g" || event.key === "u")) {
        event.preventDefault();
        // f bad, g ok, u undo. Judging a line does NOT advance to the next one:
        // deciding and moving on are separate thoughts, and a combined key would make
        // a mistaken tap cost both a wrong verdict and a lost place.
        setFlag(current, event.key === "f" ? "bad" : event.key === "g" ? "ok" : null);
      } else if (current && event.key === "n") {
        event.preventDefault();
        setNoteFor(withFlag(current));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, setFlag, step, withFlag]);

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
        query={query}
        inputRef={searchInput}
        onQueryChange={setQuery}
        onChange={updateFilters}
        onClearAll={() => router.replace("/", { scroll: false })}
      />

      <div className="flex items-center gap-4 px-4 py-2 text-muted">
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
      </div>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-44" />
          <col className="w-56" />
          <col className="w-40" />
          <col />
          <col className="w-20" />
        </colgroup>
        <thead className="text-left text-xs text-faint">
          <tr className="border-b border-border">
            <th className="px-2 py-1 font-normal">Zone</th>
            <th className="px-2 py-1 font-normal">Subzone</th>
            <th className="px-2 py-1 font-normal">State</th>
            <th className="px-2 py-1 font-normal">Lore</th>
            <th className="px-2 py-1 text-right font-normal">Chars</th>
          </tr>
        </thead>
        <tbody>
          {result?.lines.map((line) => (
            <LineRow
              key={line.id}
              line={withFlag(line)}
              current={line.id === current?.id}
              onPlay={play}
              onNarrowToZone={(l) => updateFilters({ mapID: l.mapID })}
              onFlag={setFlag}
              onNote={(l) => setNoteFor(withFlag(l))}
            />
          ))}
        </tbody>
      </table>

      {result && result.total === 0 && !loading && (
        <p className="px-4 py-8 text-center text-muted">Nothing matches these filters.</p>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-4 py-4">
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

      <p className="px-4 pb-4 text-center text-xs text-faint">
        <kbd>/</kbd> search · <kbd>space</kbd> play/pause · <kbd>j</kbd>/<kbd>k</kbd> next/previous ·{" "}
        <kbd>f</kbd> bad · <kbd>g</kbd> ok · <kbd>u</kbd> undo · <kbd>n</kbd> note
      </p>

      <NoteDialog
        line={noteFor}
        onClose={() => setNoteFor(null)}
        onSave={(line, note) => {
          setFlag(line, line.flag?.status ?? "bad", note);
          setNoteFor(null);
        }}
      />

      <div className="fixed inset-x-0 bottom-0 z-30">
        <Player line={current} version={current?.take?.version} audioRef={audio} />
      </div>
    </div>
  );
}
