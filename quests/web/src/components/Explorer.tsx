"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import NpcResult from "./NpcResult";
import Player from "./Player";
import SearchBar from "./SearchBar";
import { useSession } from "@/lib/auth-client";
import {
  fetchGenerationStatus,
  regenerate,
  type GenerationStatusResponse,
} from "@/lib/generation/client";
import { canRegenerate } from "@/lib/permissions";
import type { Filter, ResultLine, SearchResult } from "@/lib/search";
import { type Pending, receive, target, write } from "@/lib/url-echo";

/** What a line's Regenerate button is doing, keyed by lineId. */
export type LineState =
  | { phase: "busy" }
  | { phase: "done"; version: number }
  | { phase: "error"; message: string };

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
  const { data: session } = useSession();

  // Read once here and drilled down, rather than a hook per row: a broad search renders
  // thousands of LineRows.
  const showRegenerate = canRegenerate(session?.user.role);

  // The URL is the source of truth for a search, so a result is linkable and survives a
  // reload; `query` is the uncommitted keystroke state in front of it.
  const urlQuery = params.get("q") ?? "";
  const filter = (params.get("filter") as Filter) ?? "any";
  const missingOnly = params.get("missing") === "1";

  const [query, setQuery] = useState(urlQuery);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<ResultLine | null>(null);

  // Which voices exist and what is left of the character budget. Read once, and only for
  // someone who could act on it.
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  // Per-line regeneration state, and per-file version numbers used to bust the audio cache.
  const [lineStates, setLineStates] = useState<Record<string, LineState>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});

  const searchInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

  // Query values written to the URL and not yet echoed back. See lib/url-echo: the input
  // runs ahead of the URL, so an echo that arrives mid-word must not be adopted.
  const pending = useRef<Pending>([]);

  useEffect(() => {
    const step = receive(pending.current, urlQuery);
    pending.current = step.pending;
    if (step.adopt) setQuery(urlQuery);
  }, [urlQuery]);

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

  // Held in a ref so the debounce below restarts on keystrokes only. `updateUrl` changes
  // identity on every param change, and letting that reset the timer would let a filter
  // toggle mid-word push the search out by another interval.
  const updateUrlRef = useRef(updateUrl);
  useEffect(() => {
    updateUrlRef.current = updateUrl;
  }, [updateUrl]);

  useEffect(() => {
    if (query === target(pending.current, urlQuery)) return;
    const timer = setTimeout(() => {
      pending.current = write(pending.current, query);
      updateUrlRef.current({ q: query });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, urlQuery]);

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

  useEffect(() => {
    if (!showRegenerate) return;
    const controller = new AbortController();
    void fetchGenerationStatus(controller.signal).then(setStatus);
    return () => controller.abort();
  }, [showRegenerate]);

  /**
   * Why this line's Regenerate control is unavailable, or null.
   *
   * Only three of the twenty voices exist today, so this is the usual state rather than an
   * edge case. Nothing is blocked while the status is still loading: guessing wrong towards
   * "disabled" would hide a control that works.
   */
  const blockedReason = useCallback(
    (line: ResultLine): string | null => {
      if (!line.generatable) {
        return `Never voiced: ${line.skipReason}`;
      }
      if (status && !status.voices.includes(line.voice)) {
        return `No ElevenLabs voice named "${line.voice}" yet — create it on /voices`;
      }
      return null;
    },
    [status],
  );

  /**
   * Regenerate one line.
   *
   * On success the line is marked as having audio and its file's version is recorded. That
   * version becomes a query parameter on the audio URL: the path does not change when a file
   * is replaced, and /api/audio answers with a weak ETag, so without it the browser would
   * happily replay the take that was just overwritten.
   */
  const regenerateLine = useCallback(async (line: ResultLine) => {
    setLineStates((current) => ({ ...current, [line.lineId]: { phase: "busy" } }));

    const response = await regenerate(line.lineId);

    if (!response.ok) {
      setLineStates((current) => ({
        ...current,
        [line.lineId]: { phase: "error", message: response.message },
      }));
      return;
    }

    setVersions((current) => ({ ...current, [response.file]: response.version }));
    setLineStates((current) => ({
      ...current,
      [line.lineId]: { phase: "done", version: response.version },
    }));

    // Every line resolving to this file now has audio, not just the one clicked: a gossip
    // file is shared by every NPC of that race and gender who says the same thing.
    setResult((current) =>
      current
        ? {
            ...current,
            npcs: current.npcs.map((npc) => ({
              ...npc,
              audioCount: npc.quests
                .flatMap((quest) => quest.lines)
                .filter((l) => l.hasAudio || l.audioPath === response.file).length,
              quests: npc.quests.map((quest) => ({
                ...quest,
                lines: quest.lines.map((l) =>
                  l.audioPath === response.file ? { ...l, hasAudio: true } : l,
                ),
              })),
            })),
          }
        : current,
    );
  }, []);

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
        // Space stays a global play/pause even when a row control has focus. The
        // preventDefault is what keeps it from also activating that control, so buttons
        // inside a result row are reached with Enter.
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
          canRegenerate={showRegenerate}
          lineStates={lineStates}
          blockedReason={blockedReason}
          onPlay={play}
          onRegenerate={regenerateLine}
        />
      ))}

      {result && result.npcs.length === 0 && (
        <div className="text-muted-foreground py-2 text-sm">No matches.</div>
      )}

      <p className="text-muted-foreground mt-6 flex flex-wrap items-center gap-1.5 text-xs">
        <Key>/</Key> search · <Key>space</Key> play/pause · <Key>j</Key> <Key>k</Key> next
        and previous line
      </p>

      <Player ref={audio} line={current} version={current ? versions[current.audioPath] : undefined} />
    </>
  );
}
