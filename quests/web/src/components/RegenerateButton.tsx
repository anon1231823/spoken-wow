"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

const LABELS = {
  line: "Regenerate this line",
  quest: "Regenerate this quest",
  npc: "Regenerate every line for this NPC",
} as const;

type Props = {
  scope: keyof typeof LABELS;
};

/**
 * The entry point for re-running TTS over existing lines. It is deliberately inert for now:
 * the generator runs in the Python pipeline with an ElevenLabs key, and wiring the web app
 * to it needs a job queue and an audio-store write path that do not exist yet. Shipping the
 * control first is what lets the roles that gate it be built and reviewed on their own.
 */
export default function RegenerateButton({ scope }: Props) {
  return (
    <Button
      variant="ghost"
      size={scope === "line" ? "icon-xs" : "xs"}
      title={LABELS[scope]}
      aria-label={scope === "line" ? LABELS[scope] : undefined}
      onClick={() => {}}
    >
      <RefreshCw />
      {scope !== "line" && "Regenerate"}
    </Button>
  );
}
