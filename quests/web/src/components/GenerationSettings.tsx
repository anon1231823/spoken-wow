"use client";

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
import {
  SEED_STRATEGIES,
  type GenerationConfig,
  type SeedStrategy,
  type VoiceSettings,
} from "@/lib/generation/config";
import type { EffectiveSettings } from "@/lib/generation/settings";

/**
 * Models worth offering. Not a whitelist - the server accepts any non-empty string, because
 * ElevenLabs ships models faster than this list can be updated and being unable to try one
 * without a deploy is the thing this page exists to avoid.
 */
const MODELS = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2 — the pipeline's default" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5 — faster, cheaper, less nuanced" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 — fastest, lowest fidelity" },
];

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
export default function GenerationSettings({ initial }: { initial: EffectiveSettings }) {
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
      const response = await fetch("/api/generation/settings", {
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

  return (
    <Card className="mb-6 gap-0 py-0">
      <CardHeader className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-3">
        <CardTitle className="text-base">Generation settings</CardTitle>
        <span className="text-muted-foreground text-xs">
          {overridden
            ? `overriding voice/generation.json${saved.updatedAt ? ` · changed ${new Date(saved.updatedAt).toLocaleDateString()}` : ""}`
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
              {/* A model set outside this list stays selectable, so a value the CLI or a
                  future release chose is never silently rewritten by opening this page. */}
              {(MODELS.some((model) => model.id === draft.modelId)
                ? MODELS
                : [...MODELS, { id: draft.modelId, label: draft.modelId }]
              ).map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              Reset to committed defaults
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
