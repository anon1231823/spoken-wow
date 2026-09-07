"use client";

import { useState } from "react";

import type { ApiKeyStatus } from "@/lib/api-key";

// Where an editor puts their ElevenLabs key, and the only place its existence is shown.
//
// The input is emptied the moment a save succeeds, and the key is never read back from
// the server -- there is no reveal control and no round trip that could carry one. What
// is drawn instead is the hint the server stored: four characters, which prove a key is
// set and spend nothing.

type Props = { initial: ApiKeyStatus | null };

export function ApiKeySection({ initial }: Props) {
  const [status, setStatus] = useState(initial);
  const [entry, setEntry] = useState("");
  // Replacing is a separate state from having none, so a set key cannot be overwritten
  // by a stray paste into a field that was sitting there open.
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: entry.trim() }),
      });
      const body = (await response.json()) as { status?: ApiKeyStatus; error?: string };
      if (!response.ok || !body.status) throw new Error(body.error ?? "could not save that key");
      setStatus(body.status);
      setEntry("");
      setReplacing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile/api-key", { method: "DELETE" });
      if (!response.ok) throw new Error("could not remove that key");
      setStatus(null);
      setReplacing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const entering = status === null || replacing;

  return (
    <section className="max-w-xl">
      <h2 className="mb-1 font-medium">ElevenLabs key</h2>
      <p className="mb-4 text-muted">
        Regenerating a line and previewing a voice spend credits from{" "}
        <strong className="text-fg">your own</strong> ElevenLabs account, so the explorer
        needs a key of yours. It is encrypted before it is stored and is never shown again
        — only its last four characters. Find yours under your ElevenLabs profile, in API
        keys.
      </p>

      {error && (
        <p role="alert" className="mb-3 text-bad">
          {error}
        </p>
      )}

      {status && (
        <p className="mb-3">
          <span className="rounded border border-border bg-panel px-2 py-0.5 font-mono">
            sk_…••••{status.hint}
          </span>
          <span className="ml-3 text-xs text-faint">
            {status.tier && <>{status.tier} plan · </>}
            {status.verifiedAt
              ? `verified ${new Date(status.verifiedAt).toISOString().slice(0, 10)}`
              : "not verified"}
          </span>
        </p>
      )}

      {entering ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={entry}
            autoComplete="off"
            placeholder="sk_…"
            aria-label="ElevenLabs API key"
            onChange={(event) => setEntry(event.target.value)}
            className="w-80 rounded border border-border bg-panel px-2 py-1 font-mono"
          />
          <button
            type="button"
            disabled={busy || entry.trim() === ""}
            onClick={save}
            className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
          >
            {busy ? "Checking…" : "Save"}
          </button>
          {replacing && (
            <button
              type="button"
              onClick={() => {
                setEntry("");
                setReplacing(false);
                setError(null);
              }}
              className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
            >
              Cancel
            </button>
          )}
          <span className="w-full text-xs text-faint">
            Checked against ElevenLabs before it is stored, which costs no credits.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReplacing(true)}
            className="rounded border border-border px-3 py-1 hover:bg-panel-hover"
          >
            Replace
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="rounded border border-border px-3 py-1 hover:bg-panel-hover disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      )}
    </section>
  );
}
