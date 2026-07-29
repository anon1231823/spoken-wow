"use client";

import LineHistory from "./LineHistory";
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
  /** How many takes this line's file has. Zero means there is nothing to go back to. */
  takes: number;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  onRestored: (file: string, version: number) => void;
  /** Narrow the search to this line's NPC, or to its quest. */
  onNarrowToNpc: (line: ResultLine) => void;
  onNarrowToQuest: (line: ResultLine) => void;
};

export default function LineRow({
  line,
  current,
  canRegenerate,
  state,
  blocked,
  takes,
  onPlay,
  onRegenerate,
  onRestored,
  onNarrowToNpc,
  onNarrowToQuest,
}: Props) {
  const missing = absence(line);

  // The play target, the narrowing links and the regenerate control are all siblings, never
  // nested: a <button> inside a <button> is invalid HTML, and the inner click never reaches
  // its own handler. That is why the metadata line sits outside the play button rather than
  // under the text inside it.
  return (
    <div
      className={cn(
        "flex items-start gap-1 rounded-md border border-transparent pr-1 transition-colors",
        line.hasAudio && "hover:bg-muted/60",
        current && "bg-muted border-primary/60",
      )}
    >
      <div className="min-w-0 flex-1">
        <button
          data-line-key={line.key}
          aria-current={current}
          disabled={!line.hasAudio}
          onClick={() => onPlay(line)}
          title={line.hasAudio ? line.audioPath : undefined}
          className={cn(
            "flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 pt-2 text-left",
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

        {/* Who says it and when. In a flat list this is the only thing tying a line to its
            NPC, and both halves narrow the search - which is how a whole NPC or a whole
            quest is still reached in one click. */}
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 px-2 pb-1.5 text-xs">
          <button
            className="hover:text-foreground truncate underline-offset-2 hover:underline"
            title={`Show only ${line.npcName}`}
            onClick={() => onNarrowToNpc(line)}
          >
            {line.npcName}
          </button>
          <span aria-hidden>·</span>
          <span>
            {line.npcType} {line.npcId}
          </span>
          <span aria-hidden>·</span>
          {line.questId === null ? (
            <span>Gossip</span>
          ) : (
            <button
              className="hover:text-foreground truncate underline-offset-2 hover:underline"
              title={`Show only quest ${line.questId}`}
              onClick={() => onNarrowToQuest(line)}
            >
              {line.questTitle ?? `quest ${line.questId}`}
            </button>
          )}
          <span aria-hidden>·</span>
          <span>{line.voice}</span>
        </div>
      </div>

      {canRegenerate && (
        <span className="mt-1.5 flex shrink-0 items-center">
          {/* Only shown once there is something to go back to, so an untouched line keeps
              a single control rather than two. */}
          {takes > 0 && (
            <LineHistory
              file={line.audioPath}
              onRestored={(version) => onRestored(line.audioPath, version)}
            />
          )}
          <RegenerateButton
            busy={state?.phase === "busy"}
            blocked={blocked}
            onClick={() => onRegenerate(line)}
          />
        </span>
      )}
    </div>
  );
}
