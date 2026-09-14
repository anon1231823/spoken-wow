"use client";

/**
 * The form a player fills in after copying an address out of the game.
 *
 * The success screen matters more than it looks: a reporter cannot read their report back, so
 * a form that merely cleared itself would leave them with no evidence anything happened and a
 * fair chance of filing the same thing twice.
 *
 * One form for both sections, against one endpoint and one table. The two sites each had
 * their own, with their own category vocabulary, and triage was two lists -- which is two
 * places to forget to look. What differs between them is the address: a quest report carries
 * one the addon built and a zone report may carry none at all, because its report page is
 * reached with the line already identified.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { BODY_MAX, CATEGORIES, CATEGORY_LABELS, type Source } from "@/lib/reports/reports";

export default function ReportForm({
  source,
  target,
  lineId,
}: {
  source: Source;
  /** The raw address the report came in on, or null where the section has none. */
  target: string | null;
  lineId: string | null;
}) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source,
        target,
        lineId,
        category: data.get("category"),
        body: data.get("body"),
        name: data.get("name"),
        email: data.get("email"),
        website: data.get("website"),
      }),
    }).catch(() => null);

    setBusy(false);

    if (response?.ok) {
      setSent(true);
      return;
    }
    setError(
      response?.status === 429
        ? "That is a lot of reports in one hour. Try again later."
        : "The report was not accepted. Check the category and try again.",
    );
  }

  if (sent) {
    return (
      <p role="status" className="rounded border p-4 text-sm">
        Thank you — the report was filed. There is no way to look it up again, so keep the
        address if you want to check back later.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        What went wrong?
        <select
          name="category"
          defaultValue="pronunciation"
          className="bg-background rounded border px-2 py-1.5"
        >
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tell us more
        <textarea
          name="body"
          required
          maxLength={BODY_MAX}
          rows={6}
          className="bg-background rounded border px-2 py-1.5"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Your name (optional)
        <input name="name" maxLength={200} className="bg-background rounded border px-2 py-1.5" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Email, if you want a reply (optional)
        <input
          name="email"
          type="email"
          maxLength={320}
          className="bg-background rounded border px-2 py-1.5"
        />
      </label>

      {/* A honeypot. sr-only rather than display:none, which bots know to skip. */}
      <label className="sr-only" aria-hidden="true">
        Website
        <input name="website" tabIndex={-1} autoComplete="off" />
      </label>

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
