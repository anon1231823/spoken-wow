"use client";

/**
 * Sending everything the addon gathered in the background, as the file the game wrote.
 *
 * The file is read in the browser and only the envelopes in it are sent: the rest of a saved
 * variables file is the player's settings, which are nobody's business here. Each envelope is
 * previewed with the same check the single-link form uses, so what the player is told they are
 * sending is what the server will take.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { envelopesFromSavedVariables, MAX_ENVELOPES } from "@/lib/contributions/saved-variables";

import { previewOf } from "./ContributeForm";

const SOURCE_LABELS: Record<string, string> = { quests: "quest and conversation lines", books: "book pages" };

type Loaded = { envelopes: string[]; counts: Record<string, number>; unreadable: number; titles: string[] };

function load(text: string): Loaded {
  const counts: Record<string, number> = {};
  const titles: string[] = [];
  const envelopes: string[] = [];
  let unreadable = 0;
  for (const envelope of envelopesFromSavedVariables(text)) {
    const preview = previewOf(envelope);
    if (!preview.ok) {
      unreadable += 1;
      continue;
    }
    envelopes.push(envelope);
    counts[preview.source] = (counts[preview.source] ?? 0) + 1;
    const title = preview.rows.find((row) => row.label === "Title" || row.label === "Book")?.value;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return { envelopes: envelopes.slice(0, MAX_ENVELOPES), counts, unreadable, titles };
}

export default function UploadGathered({ signedInAs }: { signedInAs: string | null }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accepted: number; refused: number } | null>(null);

  async function pick(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setResult(null);
    const file = event.target.files?.[0];
    if (!file) return;
    const next = load(await file.text());
    if (next.envelopes.length === 0) {
      setLoaded(null);
      setError(
        next.unreadable
          ? "Nothing in that file could be read. Log out of the game once so it writes the file again, then pick it."
          : "That file holds nothing gathered. It should be SpokenPlayer.lua, after gathering was turned on and you logged out.",
      );
      return;
    }
    setLoaded(next);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded) return;
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/contributions/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        envelopes: loaded.envelopes,
        name: signedInAs ? null : data.get("name"),
        email: signedInAs ? null : data.get("email"),
        website: data.get("website"),
      }),
    }).catch(() => null);
    setBusy(false);

    if (response?.ok) {
      const body = (await response.json()) as { accepted: number; refused: Record<string, number> };
      setResult({ accepted: body.accepted, refused: Object.values(body.refused).reduce((a, b) => a + b, 0) });
      setLoaded(null);
      return;
    }
    setError(
      response?.status === 429
        ? "That is a lot of sending for one hour. Try again later."
        : "That did not go through. Try again in a minute.",
    );
  }

  if (result) {
    return (
      <p role="status" className="rounded border p-4 text-sm">
        Got {result.accepted} {result.accepted === 1 ? "line" : "lines"} — thank you.
        {result.refused ? ` ${result.refused} could not be used.` : ""} You can clear the gathered lines
        in the game now: Spoken Player settings, Clear gathered lines.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        Upload a file
        <span className="text-muted-foreground text-xs">
          If you turned on gathering in the game, log out, then pick{" "}
          <code>WTF/Account/&lt;your account&gt;/SavedVariables/SpokenPlayer.lua</code> from your World of
          Warcraft game folder. Only the gathered lines are sent, never your settings.
        </span>
        <input type="file" accept=".lua,.bak,text/plain" onChange={pick} className="text-sm" />
      </label>

      {loaded ? (
        <section aria-label="What will be sent" className="bg-muted rounded border p-3 text-sm">
          <ul className="flex flex-col gap-0.5">
            {Object.entries(loaded.counts).map(([source, count]) => (
              <li key={source}>
                <strong>{count}</strong> {SOURCE_LABELS[source] ?? source}
              </li>
            ))}
            {loaded.unreadable ? <li>{loaded.unreadable} that could not be read and will be left out</li> : null}
          </ul>
          {loaded.titles.length ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {loaded.titles.slice(0, 12).join(" · ")}
              {loaded.titles.length > 12 ? ` and ${loaded.titles.length - 12} more` : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      {loaded && !signedInAs ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Your name (optional)
            <input name="name" className="bg-background rounded border px-2 py-1.5" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Your email (optional)
            <input name="email" type="email" className="bg-background rounded border px-2 py-1.5" />
          </label>
        </>
      ) : null}

      <label className="sr-only" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {loaded ? (
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Sending…" : `Send ${loaded.envelopes.length} ${loaded.envelopes.length === 1 ? "line" : "lines"}`}
          </Button>
        </div>
      ) : null}
    </form>
  );
}
