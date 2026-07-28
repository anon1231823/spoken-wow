"use client";

import LineRow from "./LineRow";
import RegenerateButton from "./RegenerateButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NpcGroup, ResultLine } from "@/lib/search";

type Props = {
  npc: NpcGroup;
  currentLineId: string | null;
  canRegenerate: boolean;
  onPlay: (line: ResultLine) => void;
};

export default function NpcResult({
  npc,
  currentLineId,
  canRegenerate,
  onPlay,
}: Props) {
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
            <RegenerateButton scope="npc" />
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
              {canRegenerate && <RegenerateButton scope="quest" />}
            </div>
            {quest.lines.map((line) => (
              <LineRow
                key={line.lineId}
                line={line}
                current={line.lineId === currentLineId}
                canRegenerate={canRegenerate}
                onPlay={onPlay}
              />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
