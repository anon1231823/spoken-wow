"use client";

import { useLang } from "@/components/LangProvider";
import { BASE_LANG, withLang } from "@/lib/lang";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  SEED_STRATEGIES,
  type GenerationConfig,
  type SeedStrategy,
  type VoiceSettings,
} from "@/lib/generation/config";
import type { EffectiveSettings } from "@/lib/generation/settings";
import type { Model } from "@/lib/voices/elevenlabs";

/** What generation.json ships and the database selects. See MODEL_NOTES. */
const DEFAULT_MODEL = "eleven_v3";

/**
 * What each model means *for this project*, which is not what it means in general.
 *
 * Everything here needs one voice per race and gender to sound like the same performer
 * across hundreds of lines, so expressiveness is a cost rather than a feature. ElevenLabs
 * describes v3 as its most expressive model and documents seeds as best effort; two takes
 * of one line with the same seed came back the same length but not byte-identical on every
 * model tried, so nothing guarantees an NPC's lines will match.
 */
const MODEL_NOTES: Record<string, string> = {
  eleven_v3:
    "The default everywhere. The most expressive model, and the one that honours the pronunciation dictionary's phoneme rules.",
  eleven_multilingual_v2:
    "What the Python pipeline used to ship. Steadier across a batch, but it ignores phoneme rules and bracketed sounds entirely.",
};

const SLIDERS: { key: keyof VoiceSettings & string; label: string; hint: string }[] = [
  {
    key: "stability",
    label: "Stability",
    hint: "Low varies the delivery between takes; high flattens it. 0.5 is the API's own default.",
  },
  {
    key: "similarity_boost",
    label: "Similarity",
    hint: "How hard the model tries to match the clone, including any noise in the source clips.",
  },
  {
    key: "style",
    label: "Style",
    hint: "Exaggerates the source's delivery. Costs latency, and above ~0.5 tends to drift.",
  },
];

const STRATEGY_LABELS: Record<SeedStrategy, string> = {
  npc: "Per NPC — every line an NPC speaks draws the same way",
  none: "None — each line is an independent draw",
};

function same(a: GenerationConfig, b: GenerationConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The settings every generation uses.
 *
 * Admin-only, and shown on /voices because that is already the page about what a line will
 * sound like. Collaborators see the same values read-only in the confirm dialog before a
 * batch, which is the moment the numbers actually matter to them.
 */
export default function GenerationSettings({
  initial,
  models,
}: {
  initial: EffectiveSettings;
  /** Read from the account. Empty when ElevenLabs could not be reached. */
  models: Model[];
}) {
  const lang = useLang();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<GenerationConfig>(initial.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = !same(draft, saved.config);
  const overridden = saved.source === "database";

  function patchVoice(key: keyof VoiceSettings, value: number | boolean) {
    setDraft((current) => ({
      ...current,
      voiceSettings: { ...current.voiceSettings, [key]: value },
    }));
  }

  async function send(method: "PUT" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(withLang(lang, "/api/generation/settings"), {
        method,
        headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
        body: method === "PUT" ? JSON.stringify(draft) : undefined,
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? `request failed (${response.status})`);
        return;
      }
      const next = body as EffectiveSettings;
      setSaved(next);
      setDraft(next.config);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  // The account's models, plus the stored one if the account no longer lists it.
  const options = models.some((model) => model.id === draft.modelId)
    ? models
    : [...models, { id: draft.modelId, name: draft.modelId, description: "", maxCharacters: null, languages: 0 }];
  const chosen = options.find((model) => model.id === draft.modelId);

  return (
    <Card className="mb-6 gap-0 py-0">
      <CardHeader className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-3">
        <CardTitle className="text-base">Generation settings</CardTitle>
        <span className="text-muted-foreground text-xs">
          {saved.source === "english"
            ? "English's settings, without its accent tags, until this language saves its own"
            : overridden
              ? `${lang === BASE_LANG ? "overriding voice/generation.json" : "this language's own"}${saved.updatedAt ? ` · changed ${new Date(saved.updatedAt).toLocaleDateString()}` : ""}`
              : "the committed defaults from voice/generation.json"}
        </span>
      </CardHeader>

      <CardContent className="space-y-5 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="model">Model</Label>
          <Select
            value={draft.modelId}
            onValueChange={(value) => setDraft((current) => ({ ...current, modelId: value }))}
          >
            <SelectTrigger id="model" className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* The stored model always stays selectable, even when the account list is
                  empty or no longer contains it: opening this page must never silently
                  rewrite a model the CLI or an earlier release chose. */}
              {options.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {chosen?.description && (
            <p className="text-muted-foreground text-xs">{chosen.description}</p>
          )}
          {MODEL_NOTES[draft.modelId] && (
            <p
              className={cn(
                "text-xs",
                draft.modelId === DEFAULT_MODEL ? "text-muted-foreground" : "text-amber-400",
              )}
            >
              {MODEL_NOTES[draft.modelId]}
            </p>
          )}
          {models.length === 0 && (
            <p className="text-muted-foreground text-xs">
              Could not read the model list from ElevenLabs, so only the stored model is
              offered.
            </p>
          )}
        </div>

        {SLIDERS.map((slider) => (
          <div key={slider.key} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor={slider.key}>{slider.label}</Label>
              <span className="text-muted-foreground font-mono text-xs">
                {(draft.voiceSettings[slider.key] as number).toFixed(2)}
              </span>
            </div>
            <Slider
              id={slider.key}
              min={0}
              max={1}
              step={0.01}
              value={[draft.voiceSettings[slider.key] as number]}
              onValueChange={([value]) => patchVoice(slider.key, value)}
              className="max-w-md"
            />
            <p className="text-muted-foreground text-xs">{slider.hint}</p>
          </div>
        ))}

        <div className="flex items-start gap-2.5">
          <Checkbox
            id="speaker-boost"
            checked={draft.voiceSettings.use_speaker_boost}
            onCheckedChange={(value) => patchVoice("use_speaker_boost", value === true)}
          />
          <div className="space-y-0.5">
            <Label htmlFor="speaker-boost">Speaker boost</Label>
            <p className="text-muted-foreground text-xs">
              Sharpens resemblance to the clone at some latency cost.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seed">Seed</Label>
          <Select
            value={draft.seedStrategy}
            onValueChange={(value) =>
              setDraft((current) => ({ ...current, seedStrategy: value as SeedStrategy }))
            }
          >
            <SelectTrigger id="seed" className="w-full max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEED_STRATEGIES.map((strategy) => (
                <SelectItem key={strategy} value={strategy}>
                  {STRATEGY_LABELS[strategy]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            There is one voice per race and gender, so the seed is what keeps two NPCs sharing
            a voice from sounding like two different performances of it.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={!dirty || busy} onClick={() => void send("PUT")}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => setDraft(saved.config)}
          >
            Discard
          </Button>
          {overridden && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={busy}
              onClick={() => void send("DELETE")}
            >
              {lang === BASE_LANG ? "Reset to committed defaults" : "Follow English again"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
