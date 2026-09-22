"use client";

import { useState } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { BASE_LANG, type Lang } from "@/lib/lang";

type Row = { code: Lang; name: string; enabled: boolean };

/**
 * Which languages the site serves.
 *
 * Switching one on puts it in everybody's header; until then an admin can open it by its
 * address (/ptBR/quests) to see what is there, which is how a language gets prepared before
 * anybody else is shown it. English is what a bare address means and cannot be switched off.
 */
export default function LanguageTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, setPending] = useState<Lang | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(code: Lang, enabled: boolean) {
    setPending(code);
    setError(null);
    const response = await fetch("/api/languages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, enabled }),
    }).catch(() => null);
    setPending(null);
    if (!response?.ok) {
      setError(`Could not switch ${code} ${enabled ? "on" : "off"}.`);
      return;
    }
    const body = (await response.json()) as { languages: Row[] };
    setRows(body.languages);
  }

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <label key={row.code} className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={row.enabled}
            disabled={row.code === BASE_LANG || pending === row.code}
            onCheckedChange={(checked) => toggle(row.code, checked === true)}
          />
          <span className="w-32">{row.name}</span>
          <a
            href={row.code === BASE_LANG ? "/" : `/${row.code}`}
            className="text-muted-foreground font-mono text-xs hover:underline"
          >
            {row.code}
          </a>
        </label>
      ))}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
