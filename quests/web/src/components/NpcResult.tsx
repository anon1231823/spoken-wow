"use client";

import LineRow from "./LineRow";
import type { NpcGroup, ResultLine } from "@/lib/search";

type Props = {
  npc: NpcGroup;
  currentLineId: string | null;
  onPlay: (line: ResultLine) => void;
};

export default function NpcResult({ npc, currentLineId, onPlay }: Props) {
  return (
    <section className="npc">
      <header className="npc-head">
        <span className="npc-name">{npc.npcName}</span>
        <span className="npc-meta">
          {npc.npcType} {npc.npcId} · {npc.voice} · {npc.lineCount} lines ·{" "}
          {npc.audioCount} with audio
        </span>
      </header>
      {npc.quests.map((quest) => (
        <div className="quest" key={`${npc.key}/${quest.questId ?? "gossip"}`}>
          <div className="quest-title">
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
    </section>
  );
}
