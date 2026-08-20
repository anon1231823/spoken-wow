/**
 * The report address a corpus line would produce, for reporting from the explorer.
 *
 * The addon builds its address from what the client can see - a quest id and an event, or a
 * unit GUID - because a data module that failed to load is the failure most worth reporting.
 * A line row on the site knows the same two things and writes the same string, so a report
 * filed here and one filed from the game arrive as the same kind of row and triage never has
 * to care which came from where.
 *
 * SEPARATE FROM target.ts, which resolves an address back into corpus lines and loads the
 * corpus to do it. That is a server module; this one is imported by a row in the table.
 */
import type { CorpusLine } from "@/lib/corpus";

/** The three sources a quest address can name; gossip travels as an NPC address instead. */
const QUEST_EVENTS = new Set(["accept", "progress", "complete"]);

export function targetForLine(
  line: Pick<CorpusLine, "source" | "questId" | "npcId">,
): string | null {
  if (QUEST_EVENTS.has(line.source)) {
    // Nothing in the corpus should be a quest line without a quest, but "quest/null/accept"
    // would resolve to nothing while looking like a real report, so it is worth refusing.
    return line.questId === null ? null : `quest/${line.questId}/${line.source}`;
  }
  return line.source === "gossip" ? `npc/${line.npcId}` : null;
}
