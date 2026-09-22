"use client";

/**
 * The line a report is about, opened in place.
 *
 * A triager's loop used to be: read the row, open the explorer in another tab, find the
 * line, listen, come back. The context that picked the voice, the text as it will be
 * spoken and the button that cuts a new take are here; the audio plays through the page's
 * transport bar, the same one both explorers use, so one line stops the previous one.
 *
 * Presentational: the row is fetched by ReportTable, because the play button needs the
 * same line without this panel being open.
 */
import { useLang } from "@/components/LangProvider";
import { useState } from "react";

import OverrideDialog from "@/components/OverrideDialog";
import { Button } from "@/components/ui/button";
import { detailOf, regeneratePath, type SourceLine } from "@/lib/reports/detail";

import { noApiKeyMessage } from "@/lib/no-api-key";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { Source } from "@/lib/sections";

type Props = {
  source: Source;
  lineId: string;
  /** The line, or null once the lookup came back with none. Undefined while it is in flight. */
  line: SourceLine | null | undefined;
  /** Whether this visitor may spend credits. The page already gates the rest. */
  canRegenerate: boolean;
  /** Hands the new take's version up, so the player busts its cache. */
  onRegenerated: (version: number) => void;
  /** Hands a rewrite up, so the panel and the row read the text that will be spoken next. */
  onOverridden: (text: string | null) => void;
};

export default function ReportDetail({
  source,
  lineId,
  line,
  canRegenerate,
  onRegenerated,
  onOverridden,
}: Props) {
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setError(null);
    setDone(false);

    const response = await fetch(regeneratePath(source, lang), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineId }),
    }).catch(() => null);

    const body = (await response?.json().catch(() => ({}))) as {
      ok?: boolean;
      version?: number;
      error?: string;
      code?: string;
    };
    setBusy(false);

    if (!response) return setError("the request did not go through");

    // "You have the role but no key on file" is one page away from fixed, so it says so
    // rather than reading as a failure of the line.
    const noKey = noApiKeyMessage(response.status, body);
    if (noKey) return setError(noKey);

    if (!response.ok || !body.ok || body.version === undefined) {
      return setError(body.error ?? `failed (${response.status})`);
    }

    setDone(true);
    onRegenerated(body.version);
  }

  if (line === undefined) {
    return <p className="text-muted-foreground px-3 py-3 text-sm">Looking up the line…</p>;
  }

  // An address that resolves to nothing is itself worth reading: it means the corpus no
  // longer carries the line the report is about, which is information about the data
  // module rather than an error on this page.
  if (line === null) {
    return (
      <p className="text-muted-foreground px-3 py-3 text-sm">
        No line in the corpus carries this id any more.
      </p>
    );
  }

  const detail = detailOf(source, line, undefined, lang);

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <div>
        <span className="font-medium">{detail.heading}</span>
        <span className="text-muted-foreground ml-2 text-xs">{detail.context}</span>
      </div>

      <p className="text-sm whitespace-pre-wrap">{detail.text}</p>

      {detail.audioSrc === null ? (
        <p className="text-muted-foreground text-xs">No audio on file for this line.</p>
      ) : null}

      {canRegenerate ? (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void regenerate()}>
            {busy ? "Regenerating…" : "Regenerate"}
          </Button>
          {/* Quests only: the override endpoint is theirs, and zones and books have no text a
              triager may edit - their lines are the corpus itself. */}
          {source === "quests" ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              Rewrite
            </Button>
          ) : null}
          {done && !busy ? (
            <span className="text-muted-foreground text-xs">New take saved. Play it above.</span>
          ) : null}
          {error ? <span className="text-destructive text-xs">{error}</span> : null}
        </div>
      ) : null}

      {/* "Wrong words" and "wrong voice" are the two complaints this panel answers, so the
          fix for the first is a press away from the fix for the second: rewrite, then
          regenerate, without leaving the triage list. */}
      {editing && source === "quests" ? (
        <OverrideDialog
          line={line as QuestLine}
          onSaved={(_file, text) => {
            setEditing(false);
            onOverridden(text);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
}
