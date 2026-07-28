"use client";

import LineRow from "./LineRow";
import RegenerateButton from "./RegenerateButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LineState } from "./Explorer";
import type { NpcGroup, ResultLine } from "@/lib/search";

type Props = {
  npc: NpcGroup;
  currentLineId: string | null;
  canRegenerate: boolean;
  lineStates: Record<string, LineState>;
  blockedReason: (line: ResultLine) => string | null;
  onPlay: (line: ResultLine) => void;
  onRegenerate: (line: ResultLine) => void;
  onRegenerateBatch: (label: string, lines: ResultLine[]) => void;
  takes: Record<string, number>;
  onRestored: (file: string, version: number) => void;
};

export default function NpcResult({
  npc,
  currentLineId,
  canRegenerate,
  lineStates,
  blockedReason,
  onPlay,
  onRegenerate,
  onRegenerateBatch,
  takes,
  onRestored,
}: Props) {
  // Every line an NPC speaks uses the same voice, so one missing voice blocks all of them.
  // Taken from a generatable line rather than the first, or a quest whose only unvoiced line
  // came first would report the wrong reason.
  const anyLine = npc.quests.flatMap((quest) => quest.lines).find((line) => line.generatable);
  const npcBlocked = anyLine ? blockedReason(anyLine) : "Nothing here is ever voiced";

  return (
    <Card className="mb-3 gap-0 py-0">
      <CardHeader className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-3">
        <CardTitle className="text-base">{npc.npcName}</CardTitle>
        <span className="text-muted-foreground text-xs">
          {npc.npcType} {npc.npcId} · {npc.voice} · {npc.lineCount}{" "}
          {npc.lineCount === 1 ? "line" : "lines"} · {npc.audioCount} with audio
        </span>
        {canRegenerate && (
          <span className="ml-auto">
            <RegenerateButton
              scope="npc"
              onClick={() =>
                onRegenerateBatch(
                  `every line for ${npc.npcName}`,
                  npc.quests.flatMap((quest) => quest.lines),
                )
              }
              blocked={npcBlocked}
            />
          </span>
        )}
      </CardHeader>
      <CardContent className="px-3 py-2">
        {npc.quests.map((quest) => (
          <div key={`${npc.key}/${quest.questId ?? "gossip"}`} className="py-1.5">
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
              <span>
                {quest.title}
                {quest.questId !== null && ` · quest ${quest.questId}`}
              </span>
              {canRegenerate && (
                <RegenerateButton
                  scope="quest"
                  onClick={() =>
                    onRegenerateBatch(
                      `${quest.title} for ${npc.npcName}`,
                      quest.lines,
                    )
                  }
                  blocked={npcBlocked}
                />
              )}
            </div>
            {quest.lines.map((line) => (
              <LineRow
                key={line.lineId}
                line={line}
                current={line.lineId === currentLineId}
                canRegenerate={canRegenerate}
                state={lineStates[line.lineId]}
                blocked={blockedReason(line)}
                takes={takes[line.audioPath] ?? 0}
                onPlay={onPlay}
                onRegenerate={onRegenerate}
                onRestored={onRestored}
              />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
