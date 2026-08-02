"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// tools/voice/pronunciation.json, edited with its consequences shown.
//
// A rule here is not free and not obviously correct. It rewrites the text before it is
// sent -- spelling "Kalimdor" as "Kalimdore" and hoping -- and every line it touches
// becomes stale, which means a paid regeneration. So the editor's real job is to
// answer "how many lines does this affect and what does saving it commit me to"
// before anything is written, which is what the preview does.

type Impact = {
  matches: Record<string, number>;
  staleAfter: number;
  staleNow: number;
  totalLines: number;
};

type Rule = { from: string; to: string };

function toRules(record: Record<string, string>): Rule[] {
  return Object.entries(record).map(([from, to]) => ({ from, to }));
}

function toRecord(rules: Rule[]): Record<string, string> {
  return Object.fromEntries(
    rules.filter((rule) => rule.from.trim() !== "").map((rule) => [rule.from.trim(), rule.to]),
  );
}

export function LexiconEditor() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [impact, setImpact] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lexicon")
      .then((response) => response.json())
      .then((data: { rules: Record<string, string>; impact: Impact }) => {
        setRules(toRules(data.rules));
        setSaved(data.rules);
        setImpact(data.impact);
      })
      .catch(() => setError("could not read pronunciation.json"));
  }, []);

  const preview = useCallback((next: Rule[]) => {
    fetch("/api/lexicon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: toRecord(next), preview: true }),
    })
      .then((response) => response.json())
      .then((data: { impact?: Impact; error?: string }) => {
        if (data.impact) setImpact(data.impact);
        setError(data.error ?? null);
      })
      .catch(() => {});
  }, []);

  const save = useCallback(() => {
    setBusy(true);
    fetch("/api/lexicon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules: toRecord(rules) }),
    })
      .then((response) => response.json())
      .then((data: { rules?: Record<string, string>; impact?: Impact; error?: string }) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setSaved(data.rules ?? {});
        if (data.impact) setImpact(data.impact);
        setError(null);
      })
      .catch(() => setError("save failed"))
      .finally(() => setBusy(false));
  }, [rules]);

  const dirty = JSON.stringify(toRecord(rules)) !== JSON.stringify(saved);
  const wouldMakeStale = impact ? impact.staleAfter - impact.staleNow : 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold">Pronunciation</h1>
      <p className="mb-4 text-muted">
        Whole-word substitutions applied to the text before it is sent to ElevenLabs.
      </p>

      <div className="mb-6 rounded border border-warn/40 bg-warn/10 p-3 text-xs">
        <strong className="text-warn">Prefer the uploaded dictionary.</strong> An ElevenLabs
        pronunciation dictionary carries real IPA phoneme rules and is applied by the model,
        which is strictly better than respelling a word here and hoping. Phoneme rules are
        honoured by <code>eleven_v3</code>, which this project uses. Reach for this file only
        when a dictionary entry cannot express the fix.
      </div>

      {error && <p className="mb-4 text-bad">{error}</p>}

      <table className="mb-3 w-full">
        <thead className="text-left text-xs text-faint">
          <tr className="border-b border-border">
            <th className="py-1 font-normal">Written</th>
            <th className="py-1 font-normal">Spoken as</th>
            <th className="py-1 text-right font-normal">Lines</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule, index) => (
            <tr key={index} className="border-b border-border">
              <td className="py-1 pr-2">
                <input
                  type="text"
                  value={rule.from}
                  placeholder="Kalimdor"
                  className="w-full"
                  onChange={(event) => {
                    const next = [...rules];
                    next[index] = { ...rule, from: event.target.value };
                    setRules(next);
                  }}
                  onBlur={() => preview(rules)}
                />
              </td>
              <td className="py-1 pr-2">
                <input
                  type="text"
                  value={rule.to}
                  placeholder="Kalimdore"
                  className="w-full"
                  onChange={(event) => {
                    const next = [...rules];
                    next[index] = { ...rule, to: event.target.value };
                    setRules(next);
                  }}
                  onBlur={() => preview(rules)}
                />
              </td>
              <td className="py-1 text-right font-mono text-xs text-muted">
                {impact?.matches[rule.from.trim()] ?? "—"}
              </td>
              <td className="py-1 pl-2">
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => {
                    const next = rules.filter((_, i) => i !== index);
                    setRules(next);
                    preview(next);
                  }}
                  className="rounded p-1 text-faint hover:bg-panel-hover hover:text-bad"
                >
                  <Trash2 size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        onClick={() => setRules([...rules, { from: "", to: "" }])}
        className="mb-6 flex items-center gap-1 rounded border border-border px-2 py-1 hover:bg-panel-hover"
      >
        <Plus size={13} /> Add a rule
      </button>

      {impact && (
        <div className="mb-4 rounded border border-border bg-panel p-3">
          <p>
            {wouldMakeStale > 0 ? (
              <>
                Saving would mark{" "}
                <strong className="text-warn">{wouldMakeStale.toLocaleString()}</strong> more
                line{wouldMakeStale === 1 ? "" : "s"} stale, out of{" "}
                {impact.totalLines.toLocaleString()}.
              </>
            ) : wouldMakeStale < 0 ? (
              <>
                Saving would return{" "}
                <strong className="text-good">{Math.abs(wouldMakeStale).toLocaleString()}</strong>{" "}
                line{wouldMakeStale === -1 ? "" : "s"} to current.
              </>
            ) : (
              <>No change to what is stale.</>
            )}
          </p>
          <p className="mt-1 text-xs text-faint">
            Stale lines need regenerating to take the change. At ~0.607 credits/character
            that is what the rule really costs.{" "}
            <Link href="/?state=stale" className="text-accent hover:underline">
              See them
            </Link>
            .
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={save}
          className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save to pronunciation.json"}
        </button>
        {dirty && <span className="text-xs text-warn">unsaved changes</span>}
        {!dirty && rules.length > 0 && <span className="text-xs text-faint">saved</span>}
      </div>

      <p className="mt-6 text-xs text-faint">
        Every rule is a claim that the model mispronounces a word, and that claim can only be
        made after listening. The file ships empty on purpose.
      </p>
    </div>
  );
}
