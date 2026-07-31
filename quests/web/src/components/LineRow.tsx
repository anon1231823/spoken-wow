"use client";

import { MessageSquareIcon, PencilIcon } from "lucide-react";

import IssueChip from "./IssueChip";
import LineHistory from "./LineHistory";
import RegenerateButton from "./RegenerateButton";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";
import type { LineState } from "./Explorer";
import type { ResultLine } from "@/lib/search";

/**
 * Why a line has no audio, or null when it does.
 *
 * Reads `voiceable` rather than the corpus's `generatable`, because an override can rescue a
 * line the extractor gave up on: once the stage direction is gone, its absence is a gap like
 * any other rather than an expected skip.
 */
function absence(line: ResultLine): { kind: "gap" | "skip"; label: string } | null {
  if (line.hasAudio) return null;
  // An unvoiceable line is an expected absence, not a gap: progress text is never voiced,
  // and text with unresolved $ / <> tokens would be read aloud verbatim.
  if (!line.voiceable) {
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
  /** The live audio was made from text that has since changed. */
  stale: boolean;
  onPlay: (line: ResultLine) => void;
  onEditText: (line: ResultLine) => void;
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
  stale,
  onPlay,
  onEditText,
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

      {/* The voice slot is spelled race-gender-flavor, so this column is all three at once.
          The flavor is what distinguishes the two or three voices a race-gender has, so it
          belongs beside them rather than in a column of its own. */}
      <td className="text-muted-foreground px-2 py-2">
        <span className="block truncate">{line.race}</span>
        <span className="block truncate text-xs">
          {line.flavor ? `${line.gender} · ${line.flavor}` : line.gender}
        </span>
      </td>

      <td className="px-2 py-2">
        {line.issue ? <IssueChip issue={line.issue} /> : <span className="text-muted-foreground">—</span>}
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
          {/* The override, when there is one: this cell shows what the line says out loud,
              and after a rewrite that is no longer what the corpus holds. */}
          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !current && "line-clamp-2")}>
            {line.override ?? line.text}
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
            <span className="mt-0.5 flex shrink-0 gap-2 text-xs">
              {/* Stale before missing: "no audio" and "the audio is old" cannot both be
                  true, and a rewrite is the more actionable of the two. */}
              {stale && (
                <span className="text-amber-300" title="This audio was made from text that has since changed">
                  text changed
                </span>
              )}
              {line.override && !stale && (
                <span className="text-muted-foreground" title="This line's spoken text was rewritten">
                  rewritten
                </span>
              )}
              {missing && (
                <span
                  className={cn(
                    missing.kind === "gap" ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {missing.label}
                </span>
              )}
            </span>
          )}
        </button>
      </td>

      <td className="py-1.5 pr-1 pl-0">
        {canRegenerate && (
          <span className="flex items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              title="Edit what this line says out loud"
              aria-label={`Edit the spoken text of ${line.npcName}'s line`}
              onClick={() => onEditText(line)}
            >
              <PencilIcon className={cn("size-3.5", line.override && "text-amber-300")} />
            </Button>
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
