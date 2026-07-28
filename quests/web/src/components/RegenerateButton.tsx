"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LABELS = {
  line: "Regenerate this line",
  quest: "Regenerate this quest",
  npc: "Regenerate every line for this NPC",
} as const;

type Props = {
  scope: keyof typeof LABELS;
  onClick: () => void;
  busy?: boolean;
  /** Why the control is unavailable. Present means disabled, and says so on hover. */
  blocked?: string | null;
};

/**
 * The entry point for re-running TTS over existing lines.
 *
 * `blocked` is almost always "this race-gender voice does not exist yet" - three of the
 * twenty do - so it carries the reason rather than just disabling: a control that greys out
 * with no explanation is worse than one that is not there.
 */
export default function RegenerateButton({ scope, onClick, busy = false, blocked }: Props) {
  const label = blocked ?? LABELS[scope];

  return (
    <Button
      variant="ghost"
      size={scope === "line" ? "icon-xs" : "xs"}
      title={label}
      aria-label={scope === "line" ? label : undefined}
      disabled={busy || Boolean(blocked)}
      onClick={onClick}
    >
      {busy ? <Loader2 className={cn("animate-spin")} /> : <RefreshCw />}
      {scope !== "line" && "Regenerate"}
    </Button>
  );
}
