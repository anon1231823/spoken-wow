"use client";

import { ChevronDownIcon, MessageSquareIcon, PencilIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

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
  const [expanded, setExpanded] = useState(false);

  /**
   * Clicking the row shows the whole line, but only when the click meant that.
   *
   * Two things it must not swallow. Every control in the row - play, the narrowing links, the
   * pencil, history, regenerate - is a descendant of this handler, so a click that landed on
   * one of them is that button's business rather than a toggle. And a click that ends a drag
   * over the text is someone copying it, which is the other half of what this cell is for:
   * toggling the row out from under them would make selecting the text a fight.
   */
  function toggleFromRow(event: React.MouseEvent<HTMLTableRowElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='dialog']")) return;
    if (!window.getSelection()?.isCollapsed) return;
    setExpanded((open) => !open);
  }

  return (
    <tr
      data-line-key={line.key}
      onClick={toggleFromRow}
      className={cn(
        "border-border/60 border-b align-top transition-colors",
        // Ungated by hasAudio: every row expands now, not only the ones that play.
        "hover:bg-muted/60",
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

      {/* The text is plain markup rather than the label of a button, which is what makes it
          selectable: text inside a <button> cannot reliably be dragged over and copied. That
          is why playing needs a control of its own. */}
      <td className="p-0">
        <div className="flex w-full min-w-0 items-start gap-2 px-2 py-2">
          <button
            aria-current={current}
            disabled={!line.hasAudio}
            onClick={() => onPlay(line)}
            title={line.hasAudio ? `Play ${line.audioPath}` : undefined}
            aria-label={`Play ${line.npcName}'s line`}
            className={cn(
              "mt-px shrink-0 rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
              line.hasAudio
                ? "text-muted-foreground hover:text-foreground cursor-pointer"
                : "text-muted-foreground/30 cursor-default",
              current && "text-foreground",
            )}
          >
            <PlayIcon className="size-3.5" />
          </button>
          <SourceMark source={line.source} />
          {/* The override, when there is one: this cell shows what the line says out loud,
              and after a rewrite that is no longer what the corpus holds. */}
          <span className={cn("min-w-0 flex-1 whitespace-pre-wrap", !expanded && "line-clamp-2")}>
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
              {line.narration && (
                <span
                  className="text-sky-300"
                  title="A narrator reads this line's stage directions"
                >
                  narration
                </span>
              )}
              {line.override && !line.narrationRestored && !stale && (
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
          {/* A row click is a mouse gesture and reaches no keyboard, so the same toggle needs
              a real control. It doubles as the only thing on screen saying rows expand. */}
          <button
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse this line" : "Show the whole line"}
            title={expanded ? "Collapse" : "Show the whole line"}
            onClick={() => setExpanded((open) => !open)}
            className={cn(
              "text-muted-foreground hover:text-foreground mt-px shrink-0 cursor-pointer rounded-sm p-0.5",
              "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
            )}
          >
            <ChevronDownIcon
              className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
            />
          </button>
        </div>
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
