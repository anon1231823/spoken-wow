/**
 * Turning the address the addon produced back into corpus lines.
 *
 * The addon builds its URL from what the client can see - a quest id and an event, or a unit
 * GUID - and never from anything the data module resolved, because a module that failed to
 * load is the failure most worth reporting. So resolution happens here, against the corpus,
 * and is allowed to fail: an address that matches nothing still deserves a form.
 */
import type { Corpus, CorpusLine } from "@/lib/corpus";
import { corpus as questCorpus } from "@/lib/quests/catalogue";

/**
 * The three of lib/line-fields.ts's SOURCES that a quest address can name. The fourth,
 * `gossip`, has no quest to hang an id on and travels as an NPC address instead.
 */
const QUEST_EVENTS = ["accept", "progress", "complete"] as const;

type QuestEvent = (typeof QUEST_EVENTS)[number];

export type Target =
  | { kind: "quest"; questId: number; event: QuestEvent }
  | { kind: "npc"; npcId: number };

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isQuestEvent(value: string): value is QuestEvent {
  return (QUEST_EVENTS as readonly string[]).includes(value);
}

export function parseTarget(segments: string[]): Target | null {
  if (segments[0] === "quest" && segments.length === 3) {
    const questId = positiveInt(segments[1]);
    if (questId === null || !isQuestEvent(segments[2])) return null;
    return { kind: "quest", questId, event: segments[2] };
  }
  if (segments[0] === "npc" && segments.length === 2) {
    const npcId = positiveInt(segments[1]);
    if (npcId === null) return null;
    return { kind: "npc", npcId };
  }
  return null;
}

/** The form stored in report."target", and the path the addon builds. */
export function formatTarget(target: Target): string {
  return target.kind === "quest"
    ? `quest/${target.questId}/${target.event}`
    : `npc/${target.npcId}`;
}

/**
 * Every line the address could mean, in corpus order.
 *
 * An array rather than a line because an NPC address means all of that creature's lines and
 * the reporter picks one, and because a quest can hold separate male and female variants.
 */
export async function resolveTarget(target: Target, corpus?: Corpus): Promise<CorpusLine[]> {
  const lines = corpus ?? (await questCorpus());
  if (target.kind === "quest") {
    return lines.lines.filter(
      (line) => line.questId === target.questId && line.source === target.event,
    );
  }
  return lines.lines.filter((line) => line.npcId === target.npcId);
}
