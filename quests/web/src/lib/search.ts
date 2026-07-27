/**
 * Finding lines.
 *
 * The filter semantics deliberately mirror select_lines (tts_cli/select.py) so "npc 240"
 * means the same thing on the CLI and in the browser. They are restated here rather than
 * shared, because sharing would mean a Python subprocess per keystroke; search.test.ts is
 * what keeps the two honest.
 *
 * Results are grouped by NPC because that is the view no filename gives you: quest audio
 * is named {questID}-{source}.mp3 and gossip audio is a content hash, so an NPC's lines
 * are scattered across the store with no shared key.
 */
import type { Corpus, CorpusLine } from "./corpus";
import { npcKey } from "./corpus";
import { audioRelPath } from "./audio";

export type Filter = "any" | "npc" | "quest";

export type SearchOptions = {
  q?: string;
  filter?: Filter;
  missingOnly?: boolean;
  /** Cap on NPCs returned, so a one-letter query cannot serialise the whole corpus. */
  limit?: number;
};

export type ResultLine = CorpusLine & {
  hasAudio: boolean;
  audioPath: string;
};

export type QuestGroup = {
  /** Quest id, or null for the gossip group. */
  questId: number | null;
  title: string;
  lines: ResultLine[];
};

export type NpcGroup = {
  key: string;
  npcId: number;
  npcName: string;
  npcType: CorpusLine["npcType"];
  voice: string;
  lineCount: number;
  audioCount: number;
  quests: QuestGroup[];
};

export type SearchResult = {
  npcs: NpcGroup[];
  npcCount: number;
  lineCount: number;
  truncated: boolean;
};

export const DEFAULT_LIMIT = 50;
export const GOSSIP_GROUP_TITLE = "Gossip";

function matches(line: CorpusLine, q: string, filter: Filter): boolean {
  const asNumber = /^\d+$/.test(q) ? Number(q) : null;

  if (asNumber !== null) {
    const npcHit = line.npcId === asNumber;
    const questHit = line.questId === asNumber;
    if (filter === "npc") return npcHit;
    if (filter === "quest") return questHit;
    return npcHit || questHit;
  }

  const needle = q.toLowerCase();
  const npcHit = line.npcName.toLowerCase().includes(needle);
  const questHit = (line.questTitle ?? "").toLowerCase().includes(needle);
  if (filter === "npc") return npcHit;
  if (filter === "quest") return questHit;
  return npcHit || questHit;
}

/**
 * A gap: a line the generator would voice, with nothing in the store.
 *
 * Same definition as missing_lines (tts_cli/store.py) - lines the generator never voices
 * (progress text, unresolved template tokens) are expected absences, not gaps.
 */
export function isGap(line: CorpusLine, store: Set<string>): boolean {
  return line.generatable && !store.has(audioRelPath(line));
}

export function search(
  corpus: Corpus,
  store: Set<string>,
  { q = "", filter = "any", missingOnly = false, limit = DEFAULT_LIMIT }: SearchOptions = {},
): SearchResult {
  const query = q.trim();

  let lines = corpus.lines;
  if (query) lines = lines.filter((line) => matches(line, query, filter));
  if (missingOnly) lines = lines.filter((line) => isGap(line, store));

  const byNpc = new Map<string, NpcGroup>();
  const questGroups = new Map<string, QuestGroup>();

  for (const line of lines) {
    const key = npcKey(line);
    let npc = byNpc.get(key);
    if (!npc) {
      npc = {
        key,
        npcId: line.npcId,
        npcName: line.npcName,
        npcType: line.npcType,
        voice: line.voice,
        lineCount: 0,
        audioCount: 0,
        quests: [],
      };
      byNpc.set(key, npc);
    }

    const hasAudio = store.has(audioRelPath(line));
    npc.lineCount += 1;
    if (hasAudio) npc.audioCount += 1;

    // Gossip has no quest, so it collects into one synthetic group per NPC.
    const groupKey = `${key}/${line.questId ?? "gossip"}`;
    let group = questGroups.get(groupKey);
    if (!group) {
      group = {
        questId: line.questId,
        title: line.questTitle ?? GOSSIP_GROUP_TITLE,
        lines: [],
      };
      questGroups.set(groupKey, group);
      npc.quests.push(group);
    }
    group.lines.push({ ...line, hasAudio, audioPath: audioRelPath(line) });
  }

  const all = [...byNpc.values()];
  // Most lines first: the NPC you searched for is usually the one with the most to say.
  all.sort((a, b) => b.lineCount - a.lineCount || a.npcName.localeCompare(b.npcName));

  const npcs = all.slice(0, limit);
  for (const npc of npcs) {
    for (const group of npc.quests) {
      group.lines.sort((a, b) => a.lineId.localeCompare(b.lineId));
    }
    npc.quests.sort((a, b) => a.title.localeCompare(b.title));
  }

  return {
    npcs,
    npcCount: all.length,
    lineCount: lines.length,
    truncated: all.length > npcs.length,
  };
}
