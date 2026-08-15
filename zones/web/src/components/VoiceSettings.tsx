"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiKeyRequiredDialog } from "@/components/ApiKeyRequiredDialog";
import { BASE_LANG, langName, type Lang } from "@/lib/lang";
import { noApiKeyMessage } from "@/lib/no-api-key";
import { useLang } from "@/lib/use-lang";

// One language's voice half of tools/voice/config*.json, edited with its consequences
// shown. English is config.json; every other language is config.<code>.json over it,
// and this page under /deDE/voice is where that file first comes into being.
//
// The page's real job, like the lexicon's, is to answer "what does saving commit me
// to" before anything is written: a voice change does not mark a single line stale
// (staleness is text-hash), so it reaches players only through a regeneration pass,
// and the preview exists so that pass is only ever started after listening.

type Voice = { id: string; name: string; category: string };

type Settings = {
  stability: number;
  similarity_boost: number;
  use_speaker_boost: boolean;
};

type VoiceData = {
  lang: Lang;
  /** False until a narrator has been saved for this language; generation refuses until then. */
  configured: boolean;
  voiceId: string | null;
  voiceName: string;
  modelId: string;
  languageCode: string | null;
  /** The language's ElevenLabs pronunciation dictionary; null when it has none. */
  dictionaryId: string | null;
  voiceSettings: Partial<Settings>;
  voices: Voice[];
  creditRate: number | null;
  measuredFrom: number;
};

// v3's three documented stability modes. The API takes the number; people pick the word.
const STABILITY_MODES = [
  { value: 0, label: "Creative" },
  { value: 0.5, label: "Natural" },
  { value: 1, label: "Robust" },
] as const;

const DEFAULT_PREVIEW =
  "The Barrens stretch from the Stonetalon Mountains to the Great Sea, a sun-scorched " +
  "savanna where centaur warbands and quilboar thornweavers contest every waterhole.";

/** The file a language's voice lives in, as the page names it. */
function configFile(lang: Lang): string {
  return lang === BASE_LANG ? "config.json" : `config.${lang}.json`;
}

export function VoiceSettings() {
  const { lang } = useLang();
  const [data, setData] = useState<VoiceData | null>(null);
  const [voiceId, setVoiceId] = useState<string>("");
  const [settings, setSettings] = useState<Settings>({
    stability: 0.5,
    similarity_boost: 0.75,
    use_speaker_boost: true,
  });
  const [dictionaryId, setDictionaryId] = useState<string>("");
  const [saved, setSaved] = useState<{
    voiceId: string;
    settings: Settings;
    dictionaryId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The page cannot render at all without a key -- the voice list is the caller's own
  // ElevenLabs account -- so this covers the first load as well as the two paid actions.
  const [keyRequired, setKeyRequired] = useState<string | null>(null);

  const [previewText, setPreviewText] = useState(DEFAULT_PREVIEW);
  const [previewing, setPreviewing] = useState(false);
  const [previewCredits, setPreviewCredits] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrl = useRef<string | null>(null);

  useEffect(() => {
    // A language switch is a different file: start over rather than showing the old
    // language's voice under the new heading until the fetch lands.
    setData(null);
    setError(null);
    setSaved(null);
    fetch(`/api/voice?lang=${lang}`)
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as VoiceData & {
          error?: string;
          code?: string;
        };
        const needsKey = noApiKeyMessage(response.status, body);
        if (needsKey) {
          setKeyRequired(needsKey);
          setError("No ElevenLabs key set — the voice list comes from your own account.");
          return null;
        }
        return body;
      })
      .then((incoming: (VoiceData & { error?: string }) | null) => {
        if (!incoming) return;
        if (incoming.error) {
          setError(incoming.error);
          return;
        }
        const current: Settings = {
          stability: Number(incoming.voiceSettings.stability ?? 0.5),
          similarity_boost: Number(incoming.voiceSettings.similarity_boost ?? 0.75),
          use_speaker_boost: Boolean(incoming.voiceSettings.use_speaker_boost ?? true),
        };
        setData(incoming);
        setVoiceId(incoming.voiceId ?? "");
        setSettings(current);
        setDictionaryId(incoming.dictionaryId ?? "");
        setSaved({
          voiceId: incoming.voiceId ?? "",
          settings: current,
          dictionaryId: incoming.dictionaryId ?? "",
        });
      })
      .catch(() => setError("could not read the voice config"));

    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, [lang]);

  const save = useCallback(() => {
    setBusy(true);
    fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lang,
        voiceId,
        voiceSettings: settings,
        dictionaryId: dictionaryId.trim() || null,
      }),
    })
      .then(async (response) => {
        const result = (await response.json().catch(() => ({}))) as {
          voiceId?: string;
          error?: string;
          code?: string;
        };
        const needsKey = noApiKeyMessage(response.status, result);
        if (needsKey) {
          setKeyRequired(needsKey);
          return null;
        }
        return result;
      })
      .then((result: { voiceId?: string; error?: string } | null) => {
        if (!result) return;
        if (result.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setSaved({ voiceId, settings, dictionaryId });
        setData((current) => (current ? { ...current, configured: true } : current));
      })
      .catch(() => setError("save failed"))
      .finally(() => setBusy(false));
  }, [lang, voiceId, settings, dictionaryId]);

  const preview = useCallback(() => {
    setPreviewing(true);
    setError(null);
    fetch("/api/voice/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang, text: previewText, voiceId, voiceSettings: settings }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          const needsKey = noApiKeyMessage(response.status, body);
          if (needsKey) {
            setKeyRequired(needsKey);
            return null;
          }
          throw new Error(body.error ?? `preview failed (${response.status})`);
        }
        const credits = response.headers.get("X-Credits");
        setPreviewCredits(credits === null ? null : Number(credits));
        return response.blob();
      })
      .then((blob) => {
        if (!blob) return;
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.src = previewUrl.current;
          void audioRef.current.play();
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setPreviewing(false));
  }, [lang, previewText, voiceId, settings]);

  // The dialog rides along with the failed-to-load state: without a key there is no
  // voice list, so this branch is exactly where a keyless admin lands.
  if (error && !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-bad">{error}</p>
        <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />
      </div>
    );
  }
  if (!data) return <p className="mx-auto max-w-3xl px-4 py-6 text-faint">loading…</p>;

  const dirty =
    saved !== null &&
    (voiceId !== saved.voiceId ||
      dictionaryId !== saved.dictionaryId ||
      JSON.stringify(settings) !== JSON.stringify(saved.settings));
  // Nothing to save, and nothing to preview, until a narrator is chosen: an empty voice
  // is what an unconfigured language starts with, not a selection.
  const chosen = voiceId !== "";
  const estimate =
    data.creditRate === null ? null : Math.round(previewText.length * data.creditRate);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-1 text-lg font-semibold">Voice · {langName(lang)}</h1>
      <p className="mb-4 text-muted">
        The narrator every {langName(lang)} line is generated with, from tools/voice/
        {configFile(lang)}
        {data.languageCode && <> (language code {data.languageCode})</>}.
      </p>

      {!data.configured && (
        <div className="mb-6 rounded border border-accent/40 bg-accent/10 p-3 text-xs">
          <strong className="text-accent">No narrator picked for {langName(lang)} yet.</strong>{" "}
          Regeneration in this language refuses until one is saved here. Saving creates
          tools/voice/{configFile(lang)}; the model, dictionary and any other override can be
          added to that file by hand afterwards.
        </div>
      )}

      <div className="mb-6 rounded border border-warn/40 bg-warn/10 p-3 text-xs">
        <strong className="text-warn">Saving changes future generations only.</strong> A voice
        or settings change does not mark a single line stale — existing takes keep playing
        until they are regenerated. To hear it corpus-wide, save here, then run a
        regeneration pass from the explorer.
      </div>

      {error && <p className="mb-4 text-bad">{error}</p>}

      <div className="mb-6 grid max-w-md gap-4">
        <label className="grid gap-1">
          <span className="text-xs text-faint">Voice ({data.modelId})</span>
          <select
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            className="rounded border border-border bg-panel px-2 py-1"
          >
            {!chosen && <option value="">— pick a narrator —</option>}
            {data.voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.name} ({voice.category})
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-1">
          <span className="text-xs text-faint">Stability</span>
          <div className="flex overflow-hidden rounded border border-border">
            {STABILITY_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setSettings({ ...settings, stability: mode.value })}
                className={
                  "flex-1 px-3 py-1 " +
                  (settings.stability === mode.value
                    ? "bg-accent font-medium text-bg"
                    : "hover:bg-panel-hover")
                }
              >
                {mode.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-faint">
            Creative hallucinates across an unattended run; Robust gives up the expressiveness
            v3 was chosen for.
          </span>
        </div>

        <label className="grid gap-1">
          <span className="text-xs text-faint">
            Similarity {settings.similarity_boost.toFixed(2)}
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.similarity_boost}
            onChange={(event) =>
              setSettings({ ...settings, similarity_boost: Number(event.target.value) })
            }
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-faint">Pronunciation dictionary ID</span>
          <input
            type="text"
            value={dictionaryId}
            onChange={(event) => setDictionaryId(event.target.value)}
            placeholder="none"
            spellCheck={false}
            className="rounded border border-border bg-panel px-2 py-1 font-mono text-sm"
          />
          <span className="text-xs text-faint">
            The ElevenLabs dictionary every {langName(lang)} line is spoken through. One per
            language — an English dictionary applied to another language rewrites words
            that happen to be spelled the same. Its newest version is picked up at the start
            of each run. Blank means none.
          </span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.use_speaker_boost}
            onChange={(event) =>
              setSettings({ ...settings, use_speaker_boost: event.target.checked })
            }
          />
          <span>Speaker boost</span>
        </label>
      </div>

      <div className="mb-6 rounded border border-border bg-panel p-3">
        <p className="mb-2 text-xs text-faint">
          Preview with the selection above — spends credits, saves nothing.
        </p>
        <textarea
          value={previewText}
          onChange={(event) => setPreviewText(event.target.value)}
          rows={3}
          maxLength={1000}
          className="mb-2 w-full rounded border border-border bg-bg px-2 py-1"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={previewing || !chosen || previewText.trim() === ""}
            onClick={preview}
            className="rounded bg-warn px-3 py-1 font-medium text-bg disabled:opacity-40"
          >
            {previewing ? "Generating…" : "Preview"}
          </button>
          <span className="text-xs text-faint">
            {previewText.length.toLocaleString()} chars
            {estimate !== null && <> · ~{estimate.toLocaleString()} credits</>}
            {previewCredits !== null && <> · last preview billed {previewCredits}</>}
          </span>
          {/* Styled native controls, not the corpus Player: a preview is not a line. */}
          <audio ref={audioRef} controls className="ml-auto h-8" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || !chosen || busy}
          onClick={save}
          className="rounded bg-accent px-3 py-1 font-medium text-bg disabled:opacity-40"
        >
          {busy ? "Saving…" : `Save to ${configFile(lang)}`}
        </button>
        {dirty && <span className="text-xs text-warn">unsaved changes</span>}
        {!dirty && data.configured && <span className="text-xs text-faint">saved</span>}
      </div>

      <ApiKeyRequiredDialog message={keyRequired} onClose={() => setKeyRequired(null)} />
    </div>
  );
}
