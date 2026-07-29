"use client";

import { MessageSquareIcon } from "lucide-react";

import LineHistory from "./LineHistory";
import RegenerateButton from "./RegenerateButton";
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

/**
 * The game's own quest markers, because the reader already knows them: yellow "!" over an
 * NPC means a quest to take, yellow "?" one to hand in. Progress keeps the family with a
 * minus - nothing to do here yet - and gossip, which the game marks with no overhead icon
 * at all, gets a grey speech bubble instead of a fourth punctuation mark nobody would read.
 */
const QUEST_MARKS: Record<string, { glyph: string; label: string }> = {
  accept: { glyph: "!", label: "quest offered" },
  complete: { glyph: "?", label: "quest turn-in" },
  progress: { glyph: "−", label: "quest in progress" },
};

function SourceMark({ source }: { source: string }) {
  if (source === "gossip") {
    return (
      <span title="gossip" aria-label="gossip" className="mt-1 flex w-3.5 shrink-0 justify-center">
        <MessageSquareIcon className="size-3.5 text-zinc-400" />
      </span>
    );
  }

  const mark = QUEST_MARKS[source];
  if (!mark) return null;

  return (
    <span
      title={mark.label}
      aria-label={source}
      className="mt-px w-3.5 shrink-0 text-center text-sm leading-5 font-bold text-amber-400"
    >
      {mark.glyph}
    </span>
  );
}

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

  // Only the text cell plays. The narrowing links and the regenerate control are siblings of
  // that button, never nested inside it: a <button> inside a <button> is invalid HTML, and
  // the inner click never reaches its own handler.
  return (
    <tr
      className={cn(
        "border-border/60 border-b align-top transition-colors",
        line.hasAudio && "hover:bg-muted/60",
        current && "bg-muted",
      )}
    >
      <td className="px-2 py-2">
        <button
          className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
          title={`Show only ${line.npcName}`}
          onClick={() => onNarrowToNpc(line)}
        >
          {line.npcName}
        </button>
        <span className="text-muted-foreground block truncate text-xs">
          {line.npcType} {line.npcId}
        </span>
      </td>

      <td className="px-2 py-2">
        {line.questId === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <button
              className="hover:text-foreground block max-w-full truncate text-left underline-offset-2 hover:underline"
              title={`Show only quest ${line.questId}`}
              onClick={() => onNarrowToQuest(line)}
            >
              {line.questTitle ?? `quest ${line.questId}`}
            </button>
            <span className="text-muted-foreground block truncate text-xs">
              quest {line.questId}
            </span>
          </>
        )}
      </td>

      {/* The voice slot is spelled race-gender, so this column is both at once. */}
      <td className="text-muted-foreground px-2 py-2">
        <span className="block truncate">{line.race}</span>
        <span className="block truncate text-xs">{line.gender}</span>
      </td>

      <td className="p-0">
        <button
          data-line-key={line.key}
          aria-current={current}
          disabled={!line.hasAudio}
          onClick={() => onPlay(line)}
          title={line.hasAudio ? line.audioPath : undefined}
          className={cn(
            "flex w-full min-w-0 items-start gap-2 px-2 py-2 text-left",
            "focus-visible:ring-ring/50 rounded-sm focus-visible:ring-[3px] focus-visible:outline-none",
            line.hasAudio ? "cursor-pointer" : "cursor-default",
          )}
        >
          <SourceMark source={line.source} />
          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !current && "line-clamp-2")}>
            {line.text}
          </span>
          {/* The regeneration outcome replaces the absence marker: once a line has just been
              made, "no audio" is stale and confusing rather than merely redundant. */}
          {state?.phase === "error" ? (
            <span className="text-destructive mt-0.5 max-w-[12rem] shrink-0 text-right text-xs">
              {state.message}
            </span>
          ) : state?.phase === "done" ? (
            <span className="mt-0.5 shrink-0 text-xs text-emerald-400">
              regenerated{state.version > 0 && ` · v${state.version}`}
            </span>
          ) : (
            missing && (
              <span
                className={cn(
                  "mt-0.5 shrink-0 text-xs",
                  missing.kind === "gap" ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {missing.label}
              </span>
            )
          )}
        </button>
      </td>

      <td className="py-1.5 pr-1 pl-0">
        {canRegenerate && (
          <span className="flex items-center justify-end">
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
      </td>
    </tr>
  );
}
