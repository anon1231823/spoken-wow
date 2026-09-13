"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiKeyStatus } from "@/lib/api-key";

/**
 * Where a collaborator puts their ElevenLabs key, and the only place its existence is shown.
 *
 * The input is emptied the moment a save succeeds, and the key is never read back from the
 * server -- there is no reveal control and no round trip that could carry one. What is drawn
 * instead is the hint the server stored: four characters, which prove a key is set and spend
 * nothing.
 */
export default function ApiKeySection({ initial }: { initial: ApiKeyStatus | null }) {
  const [status, setStatus] = useState(initial);
  const [entry, setEntry] = useState("");
  // Replacing is a separate state from having none, so a set key cannot be overwritten by a
  // stray paste into a field that was sitting there open.
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const entering = status === null || replacing;

  return (
    <section className="max-w-xl">
      <h2 className="mb-1 font-medium">ElevenLabs key</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        Regenerating a line, cloning a voice and previewing a pronunciation all spend credits
        from <strong className="text-foreground">your own</strong> ElevenLabs account, so this
        site needs a key of yours. It is encrypted before it is stored and is never shown
        again — only its last four characters. Find yours under your ElevenLabs profile, in
        API keys.
      </p>

      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm">
          {error}
        </p>
      )}

      {status && (
        <p className="mb-3 text-sm">
          <span className="bg-muted rounded border px-2 py-0.5 font-mono">
            sk_…••••{status.hint}
          </span>
          <span className="text-muted-foreground ml-3 text-xs">
            {status.tier && <>{status.tier} plan · </>}
            {status.verifiedAt
              ? `verified ${new Date(status.verifiedAt).toISOString().slice(0, 10)}`
              : "not verified"}
          </span>
        </p>
      )}

      {entering ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="password"
            value={entry}
            autoComplete="off"
            placeholder="sk_…"
            aria-label="ElevenLabs API key"
            onChange={(event) => setEntry(event.target.value)}
            className="w-80 font-mono"
          />
          <Button type="button" disabled={busy || entry.trim() === ""} onClick={save}>
            {busy ? "Checking…" : "Save"}
          </Button>
          {replacing && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEntry("");
                setReplacing(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          )}
          <span className="text-muted-foreground w-full text-xs">
            Checked against ElevenLabs before it is stored, which costs no credits.
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={remove}>
            Remove
          </Button>
        </div>
      )}
    </section>
  );
}
