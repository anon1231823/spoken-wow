"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";

import { BASE_LANG, langName, type Lang } from "@/lib/lang";
import type { ResultLine } from "@/lib/search";

// Rewriting a line, and putting an earlier wording back.
//
// The text is the one thing the explorer could not change until now: it could tell you a
// line was wrong, flag it, collect reports about it and pay to have it spoken again, but
// the words came from a file and had to be fixed in a checkout. This is where a fourth-
// wall break or a post-vanilla sentence gets fixed by the person who noticed it.
//
// Saving does not regenerate. The line becomes stale -- its text no longer hashes to what
// was spoken -- and joins the regeneration worklist, where spending credits stays a
// separate, deliberate act.

type Version = {
  version: number;
  isCurrent: boolean;
  origin: "scraped" | "edited" | "scraped-rewritten" | "translated";
  full: string;
  note: string | null;
  createdAt: string;
};

type Props = {
  line: ResultLine | null;
  /** Which language is being written. English edits the lore; anything else translates it. */
  lang?: Lang;
  onClose: () => void;
  /** Told the new text so the row can update without a reload. */
  onSaved: (line: ResultLine, full: string) => void;
};

export function LoreDialog({ line, lang = BASE_LANG, onClose, onSaved }: Props) {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the edit started from. Sent back on save so a line someone else rewrote in the
  // meantime is a visible conflict rather than a silent overwrite of their paragraph.
  const [baseVersion, setBaseVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!line) {
      dialog.current?.close();
      return;
    }

    // An untranslated line carries no text at all, so this is empty either way; the
    // English to work from is shown above the box, not in it.
    setText(line.text);
    setNote("");
    setError(null);
    setVersions(null);
    setBaseVersion(null);
    if (!dialog.current?.open) dialog.current?.showModal();

    let cancelled = false;
    const params = new URLSearchParams({ lineId: line.id });
    if (lang !== BASE_LANG) params.set("lang", lang);

    fetch(`/api/lore?${params}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("could not load history"))))
      .then((data: { versions: Version[] }) => {
        if (cancelled) return;
        setVersions(data.versions);
        setBaseVersion(data.versions.find((v) => v.isCurrent)?.version ?? null);
      })
      .catch(() => {
        if (!cancelled) setVersions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [lang, line]);

  const save = useCallback(async () => {
    if (!line) return;
    setBusy(true);
    setError(null);

    const res = await fetch("/api/lore", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        lineId: line.id,
        full: text,
        note: note.trim() || null,
        expectedVersion: baseVersion,
        lang,
      }),
    }).catch(() => null);

    setBusy(false);

    if (!res || !res.ok) {
      const message = res ? ((await res.json().catch(() => ({}))).error ?? res.statusText) : "network error";
      setError(String(message));
      return;
    }

    onSaved(line, text.trim());
    onClose();
  }, [baseVersion, lang, line, note, onClose, onSaved, text]);

  const restore = useCallback(
    async (version: number) => {
      if (!line) return;
      setBusy(true);
      setError(null);

      const res = await fetch("/api/lore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: line.id, version, lang }),
      }).catch(() => null);

      setBusy(false);

      if (!res || !res.ok) {
        setError("could not restore that version");
        return;
      }

      const data = (await res.json()) as { version: { full: string } };
      onSaved(line, data.version.full);
      onClose();
    },
    [lang, line, onClose, onSaved],
  );

  if (!line) return null;

  const changed = text.trim() !== line.text.trim();

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      className="fixed top-1/2 left-1/2 w-[46rem] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-panel p-4 text-fg backdrop:bg-black/60"
    >
      <h2 className="font-medium">{line.kind === "zone" ? line.zoneName : line.name}</h2>
      <p className="mb-3 text-xs text-faint">
        {line.zoneName} · {line.file}
      </p>

      {line.english !== undefined && (
        <div className="mb-3">
          <div className="mb-1 text-xs tracking-wide text-muted uppercase">
            English — {langName(lang)} translation below
          </div>
          {/* Read-only, and always shown when translating: the English is the source
              text, and a translator working from memory of what the row said is how a
              paragraph quietly loses a sentence. */}
          <p className="max-h-40 overflow-y-auto rounded border border-border bg-bg p-2 text-sm whitespace-pre-wrap text-muted">
            {line.english}
          </p>
        </div>
      )}

      <textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={14}
        className="w-full rounded border border-border bg-bg p-2 font-mono text-sm leading-relaxed"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />

      <div className="mt-1 flex items-baseline justify-between text-xs text-faint">
        <span>{text.trim().length} characters</span>
        {changed && (
          <span className="text-warn">
            saving marks the audio stale — regenerating it stays a separate step
          </span>
        )}
      </div>

      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why this change? (optional, kept with the version)"
        className="mt-3 w-full rounded border border-border bg-bg p-2 text-sm"
      />

      {error && <p className="mt-2 text-sm text-bad">{error}</p>}

      {versions !== null && versions.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-faint hover:text-fg">
            {versions.length} versions
          </summary>
          <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {versions.map((version) => (
              <li key={version.version} className="flex items-baseline gap-2">
                <span className="w-8 shrink-0 font-mono text-faint">v{version.version}</span>
                <span className="w-28 shrink-0 truncate text-faint">{version.origin}</span>
                <span className="truncate text-muted" title={version.full}>
                  {version.note ?? version.full}
                </span>
                {version.isCurrent ? (
                  <span className="ml-auto shrink-0 text-good">live</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void restore(version.version)}
                    title="Make this the live text"
                    className="ml-auto shrink-0 rounded p-1 text-faint/50 hover:bg-panel-hover hover:text-fg"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-faint">⌘↵ to save</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !changed}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-bg hover:opacity-90 disabled:opacity-40"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          Save
        </button>
      </div>
    </dialog>
  );
}
