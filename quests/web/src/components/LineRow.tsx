"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
  onPlay: (line: ResultLine) => void;
};

export default function LineRow({ line, current, onPlay }: Props) {
  const missing = absence(line);

  return (
    <button
      data-line-id={line.lineId}
      aria-current={current}
      disabled={!line.hasAudio}
      onClick={() => onPlay(line)}
      title={line.hasAudio ? line.audioPath : undefined}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-md border border-transparent p-2 text-left",
        "focus-visible:ring-ring/50 transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
        line.hasAudio ? "hover:bg-muted/60 cursor-pointer" : "cursor-default",
        current && "bg-muted border-primary/60",
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
      {missing && (
        <span
          className={cn(
            "mt-1 shrink-0 text-xs",
            missing.kind === "gap" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {missing.label}
        </span>
      )}
    </button>
  );
}
