"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GrantRow } from "@/lib/grants/store";
import { BASE_LANG, CODES, isLang, langName, type Lang } from "@/lib/lang";
import { CAPABILITIES, type Capability } from "@/lib/permissions";

/**
 * Who may do what in which language, and a form to add to it.
 *
 * `languages` is null for a global admin, who may grant anything anywhere; otherwise the
 * languages the viewer administers, where they may grant `edit` and `regenerate` only. The
 * server refuses anything else whatever this offers.
 */
export default function GrantTable({
  initial,
  languages,
}: {
  initial: GrantRow[];
  languages: string[] | null;
}) {
  const [rows, setRows] = useState(initial);
  const [email, setEmail] = useState("");
  const offeredLangs: readonly Lang[] =
    languages?.filter(isLang) ?? CODES.filter((code) => code !== BASE_LANG);
  const offeredCaps: readonly Capability[] = languages === null ? CAPABILITIES : ["edit", "regenerate"];
  const [lang, setLang] = useState<Lang | "">(offeredLangs[0] ?? "");
  const [capability, setCapability] = useState<Capability>("edit");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: "PUT" | "DELETE", target: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const response = await fetch(target, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    const data = (await response?.json().catch(() => ({}))) as { grants?: GrantRow[]; error?: string };
    if (!response?.ok || !data.grants) {
      setError(data?.error ?? "that did not work");
      return false;
    }
    setRows(data.grants);
    return true;
  }

  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1">Who</th>
            <th className="py-1">Language</th>
            <th className="py-1">May</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-muted-foreground py-2">
                Nobody holds anything in a language yet.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={`${row.userId}:${row.lang}:${row.capability}`} className="border-t">
                <td className="py-1.5">{row.email}</td>
                <td className="py-1.5">{langName(row.lang as Lang)}</td>
                <td className="py-1.5">{row.capability}</td>
                <td className="py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void send(
                        "DELETE",
                        `/api/grants?${new URLSearchParams({
                          userId: row.userId,
                          lang: row.lang,
                          capability: row.capability,
                        })}`,
                      )
                    }
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!lang) return;
          void send("PUT", "/api/grants", { email, lang, capability }).then((ok) => {
            if (ok) setEmail("");
          });
        }}
      >
        <Input
          type="email"
          required
          placeholder="their registered email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-64"
        />
        <Select value={lang} onValueChange={(value) => setLang(value as Lang)}>
          <SelectTrigger className="w-40" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {offeredLangs.map((code) => (
              <SelectItem key={code} value={code}>
                {langName(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={capability} onValueChange={(value) => setCapability(value as Capability)}>
          <SelectTrigger className="w-36" aria-label="Capability">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {offeredCaps.map((cap) => (
              <SelectItem key={cap} value={cap}>
                {cap}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !lang}>
          Grant
        </Button>
      </form>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
}
