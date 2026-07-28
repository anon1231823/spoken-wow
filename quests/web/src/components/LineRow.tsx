"use client";

import RegenerateButton from "./RegenerateButton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LineState } from "./Explorer";
import type { ResultLine } from "@/lib/search";

/** Why a line has no audio, or null when it does. */
function absence(line: ResultLine): { kind: "gap" | "skip"; label: string } | null {
  if (line.hasAudio) return null;
  // An ungeneratable line is an expected absence, not a gap: progress text is never
  // voiced, and text with unresolved $ / <> tokens would be read aloud verbatim.
  if (!line.generatable) {
    return { kind: "skip", label: line.skipReason ?? "not voiced" };
  }
  return { kind: "gap", label: "no audio" };
}

const SOURCE_STYLES: Record<string, string> = {
  accept: "text-emerald-400",
  complete: "text-sky-400",
  gossip: "text-violet-400",
  progress: "text-muted-foreground",
};

type Props = {
  line: ResultLine;
  current: boolean;
  canRegenerate: boolean;
  state?: LineState;
  blocked: string | null;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
};

export default function LineRow({
  line,
  current,
  canRegenerate,
  state,
  blocked,
  onPlay,
  onRegenerate,
}: Props) {
  const missing = absence(line);

  // The play target and the regenerate control are siblings, not nested: a <button> inside
  // a <button> is invalid HTML, and the inner click never reaches its own handler.
  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-md border border-transparent pr-1 transition-colors",
        line.hasAudio && "hover:bg-muted/60",
        current && "bg-muted border-primary/60",
      )}
    >
      <button
        data-line-id={line.lineId}
        aria-current={current}
        disabled={!line.hasAudio}
        onClick={() => onPlay(line)}
        title={line.hasAudio ? line.audioPath : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start gap-2.5 rounded-md p-2 text-left",
          "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
          line.hasAudio ? "cursor-pointer" : "cursor-default",
        )}
      >
        <Badge
          variant="outline"
          className={cn("mt-0.5 shrink-0 uppercase", SOURCE_STYLES[line.source])}
        >
          {line.source}
        </Badge>
        <span
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap",
            !current && "line-clamp-2",
          )}
        >
          {line.text}
        </span>
        {/* The regeneration outcome replaces the absence marker: once a line has just been
            made, "no audio" is stale and confusing rather than merely redundant. */}
        {state?.phase === "error" ? (
          <span className="text-destructive mt-1 max-w-[18rem] shrink-0 text-right text-xs">
            {state.message}
          </span>
        ) : state?.phase === "done" ? (
          <span className="mt-1 shrink-0 text-xs text-emerald-400">
            regenerated{state.version > 0 && ` · v${state.version}`}
          </span>
        ) : (
          missing && (
            <span
              className={cn(
                "mt-1 shrink-0 text-xs",
                missing.kind === "gap" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {missing.label}
            </span>
          )
        )}
      </button>

      {canRegenerate && (
        <span className="mt-1.5 shrink-0">
          <RegenerateButton
            scope="line"
            busy={state?.phase === "busy"}
            blocked={blocked}
            onClick={() => onRegenerate(line)}
          />
        </span>
      )}
    </div>
  );
}
