"use client";

import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onClick: () => void;
  busy?: boolean;
  /** Why the control is unavailable. Present means disabled, and says so on hover. */
  blocked?: string | null;
};

/**
 * Re-run TTS over one line.
 *
 * `blocked` is almost always "this race-gender voice does not exist yet" - three of the
 * twenty do - so it carries the reason rather than just disabling: a control that greys out
 * with no explanation is worse than one that is not there.
 *
 * Regenerating more than one line is not this control: that acts on the whole search, is
 * priced first, and lives in the results header.
 */
export default function RegenerateButton({ onClick, busy = false, blocked }: Props) {
  const label = blocked ?? "Regenerate this line";

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={label}
      aria-label={label}
      disabled={busy || Boolean(blocked)}
      onClick={onClick}
    >
      {busy ? <Loader2 className={cn("animate-spin")} /> : <RefreshCw />}
    </Button>
  );
}
