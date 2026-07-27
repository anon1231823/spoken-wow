"use client";

import LineRow from "./LineRow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { NpcGroup, ResultLine } from "@/lib/search";

type Props = {
  npc: NpcGroup;
  currentLineId: string | null;
  onPlay: (line: ResultLine) => void;
};

export default function NpcResult({ npc, currentLineId, onPlay }: Props) {
  return (
    <Card className="mb-3 gap-0 py-0">
      <CardHeader className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b py-3">
        <CardTitle className="text-base">{npc.npcName}</CardTitle>
        <span className="text-muted-foreground text-xs">
          {npc.npcType} {npc.npcId} · {npc.voice} · {npc.lineCount}{" "}
          {npc.lineCount === 1 ? "line" : "lines"} · {npc.audioCount} with audio
        </span>
      </CardHeader>
      <CardContent className="px-3 py-2">
        {npc.quests.map((quest) => (
          <div key={`${npc.key}/${quest.questId ?? "gossip"}`} className="py-1.5">
            <div className="text-muted-foreground px-2 py-1 text-xs">
              {quest.title}
              {quest.questId !== null && ` · quest ${quest.questId}`}
            </div>
            {quest.lines.map((line) => (
              <LineRow
                key={line.lineId}
                line={line}
                current={line.lineId === currentLineId}
                onPlay={onPlay}
              />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
