"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import NpcResult from "./NpcResult";
import Player from "./Player";
import SearchBar from "./SearchBar";
import type { Filter, ResultLine, SearchResult } from "@/lib/search";

const DEBOUNCE_MS = 200;

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted rounded border border-b-2 px-1.5 py-px font-mono text-[11px]">
      {children}
    </kbd>
  );
}

export default function Explorer() {
  const router = useRouter();
  const params = useSearchParams();

  // The URL is the source of truth for a search, so a result is linkable and survives a
  // reload; `query` is the uncommitted keystroke state in front of it.
  const urlQuery = params.get("q") ?? "";
  const filter = (params.get("filter") as Filter) ?? "any";
  const missingOnly = params.get("missing") === "1";

  const [query, setQuery] = useState(urlQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ResultLine | null>(null);

  const searchInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  const updateUrl = useCallback(
    (next: { q?: string; filter?: Filter; missing?: boolean }) => {
      const search = new URLSearchParams(params.toString());
      const set = (key: string, value: string, fallback: string) =>
        value === fallback ? search.delete(key) : search.set(key, value);

      if (next.q !== undefined) set("q", next.q, "");
      if (next.filter !== undefined) set("filter", next.filter, "any");
      if (next.missing !== undefined) set("missing", next.missing ? "1" : "", "");

      router.replace(search.toString() ? `/?${search}` : "/", { scroll: false });
    },
    [params, router],
  );

  useEffect(() => {
    if (query === urlQuery) return;
    const timer = setTimeout(() => updateUrl({ q: query }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, urlQuery, updateUrl]);

  // An empty query with no gap filter would ask for all 2,619 NPCs; show nothing instead.
  const idle = !urlQuery && !missingOnly;

  useEffect(() => {
    if (idle) {
      setResult(null);
      return;
    }
    const controller = new AbortController();
    const search = new URLSearchParams({ q: urlQuery, filter });
    if (missingOnly) search.set("missing", "1");

    setLoading(true);
    fetch(`/api/search?${search}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SearchResult) => {
        setResult(data);
        setLoading(false);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoading(false);
      });

    return () => controller.abort();
  }, [urlQuery, filter, missingOnly, idle]);

  const play = useCallback((line: ResultLine) => {
    setCurrent(line);
    // The src changes with `current`, so play after React has committed it.
    queueMicrotask(() => void audio.current?.play().catch(() => {}));
  }, []);

  // A flat, in-display-order list of what can actually be played, for j/k.
  const playable = useMemo(
    () =>
      (result?.npcs ?? []).flatMap((npc) =>
        npc.quests.flatMap((quest) => quest.lines.filter((line) => line.hasAudio)),
      ),
    [result],
  );

  const step = useCallback(
    (delta: number) => {
      if (!playable.length) return;
      const at = current ? playable.findIndex((l) => l.lineId === current.lineId) : -1;
      const next = playable[Math.min(Math.max(at + delta, 0), playable.length - 1)];
      if (next) play(next);
    },
    [playable, current, play],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // The shadcn Select trigger is a <button role="combobox">, not a <select>, so
      // checking tagName alone would let space both toggle audio and open the dropdown.
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target &&
        (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
          target.isContentEditable ||
          !!target.closest('[role="combobox"],[role="listbox"],[role="dialog"]'));

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
        return;
      }
      if (typing) return;

      if (event.key === " ") {
        event.preventDefault();
        const el = audio.current;
        if (el?.src) void (el.paused ? el.play().catch(() => {}) : el.pause());
      } else if (event.key === "j") {
        step(1);
      } else if (event.key === "k") {
        step(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step]);

  useEffect(() => {
    if (!current) return;
    document
      .querySelector(`[data-line-id="${CSS.escape(current.lineId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <>
      <SearchBar
        ref={searchInput}
        query={query}
        filter={filter}
        missingOnly={missingOnly}
        onQuery={setQuery}
        onFilter={(value) => updateUrl({ filter: value })}
        onMissingOnly={(value) => updateUrl({ missing: value })}
      />

      <div className="text-muted-foreground pt-3 pb-1 text-sm">
        {idle
          ? "Type an NPC name or id, or a quest title or id."
          : loading && !result
            ? "Searching…"
            : result
              ? `${plural(result.lineCount, "line")} across ${plural(result.npcCount, "NPC")}` +
                (result.truncated ? `, showing the first ${result.npcs.length}` : "")
              : ""}
      </div>

      {result?.npcs.map((npc) => (
        <NpcResult
          key={npc.key}
          npc={npc}
          currentLineId={current?.lineId ?? null}
          onPlay={play}
        />
      ))}

      {result && result.npcs.length === 0 && (
        <div className="text-muted-foreground py-2 text-sm">No matches.</div>
      )}

      <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
        <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next
        and previous line
      </p>

      <Player ref={audio} line={current} />
    </>
  );
}
