"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiKeyRequiredDialog } from "@/components/ApiKeyRequiredDialog";
import { BASE_LANG, langName } from "@/lib/lang";
import { noApiKeyMessage } from "@/lib/no-api-key";
import { useLang } from "@/lib/use-lang";

// One language's pronunciation dictionary id, from its voice config file.
//
// The rules themselves are edited elsewhere for now -- the ElevenLabs dictionary in
// wow-voiceover, the pre-synthesis respellings in tools/voice/pronunciation.json --
// and this page names which dictionary the language is spoken through. It grows into
// the editor later; the id is the one field it cannot start without.

export function PronunciationSettings() {
  const { lang } = useLang();
  const [dictionaryId, setDictionaryId] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyRequired, setKeyRequired] = useState<string | null>(null);

  useEffect(() => {
    setSaved(null);
    setError(null);
    fetch(`/api/pronunciation?lang=${lang}`)
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("could not read the config")),
      )
      .then((data: { dictionaryId: string | null }) => {
        setDictionaryId(data.dictionaryId ?? "");
        setSaved(data.dictionaryId ?? "");
      })
      .catch((err: Error) => setError(err.message));
  }, [lang]);

  const save = useCallback(() => {
    setBusy(true);
    setError(null);
    fetch("/api/pronunciation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, dictionaryId: dictionaryId.trim() || null }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as {
          dictionaryId?: string | null;
          error?: string;
          code?: string;
        };
        const needsKey = noApiKeyMessage(response.status, result);
        if (needsKey) {
          setKeyRequired(needsKey);
          return;
        }
        if (result.error) {
          setError(result.error);
          return;
        }
        setDictionaryId(result.dictionaryId ?? "");
        setSaved(result.dictionaryId ?? "");
      })
      .catch(() => setError("save failed"))
      .finally(() => setBusy(false));
  }, [lang, dictionaryId]);

  if (saved === null && !error) {
    return <p className="mx-auto max-w-3xl px-4 py-6 text-faint">loading…</p>;
  }

  const file = lang === BASE_LANG ? "config.json" : `config.${lang}.json`;
  const dirty = saved !== null && dictionaryId.trim() !== saved;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold">Pronunciation · {langName(lang)}</h1>
      <p className="mb-4 text-muted">
        The ElevenLabs dictionary every {langName(lang)} line is spoken through, from
        tools/voice/{file}. One per language — an English dictionary applied to another
        language rewrites words that happen to be spelled the same. Its newest version is
        picked up at the start of each run.
      </p>

      {error && <p className="mb-4 text-bad">{error}</p>}

      <label className="mb-6 grid max-w-md gap-1">
        <span className="text-xs text-faint">Dictionary ID</span>
        <input
          type="text"
          value={dictionaryId}
          onChange={(event) => setDictionaryId(event.target.value)}
          placeholder="none"
          spellCheck={false}
          className="rounded border border-border bg-panel px-2 py-1 font-mono text-sm"
        />
        <span className="text-xs text-faint">
          Checked against your ElevenLabs account on save. Blank means none.
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={save}
          className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
        >
          {busy ? "Saving…" : `Save to ${file}`}
        </button>
        {dirty && <span className="text-xs text-warn">unsaved changes</span>}
        {!dirty && saved !== null && <span className="text-xs text-faint">saved</span>}
      </div>

      <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />
    </div>
  );
}
