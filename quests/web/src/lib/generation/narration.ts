/**
 * Telling an NPC's words apart from the game's stage directions.
 *
 * Blizzard writes directions inside angle brackets, inside the NPC's own quest text:
 * "<Advisor Belgrum opens the note and begins to read.>" is not the dwarf speaking, and having
 * him read it aloud in character is worse than saying nothing.
 *
 * Free of node imports on purpose: the search filter and the result row both need this and run
 * in the browser. Same reasoning as the note atop lib/line-fields.ts.
 */

/**
 * The one narrator, for now.
 *
 * Not in the corpus and not a `race-gender-flavor` slot, so it is resolved by name against the
 * account's voices at generation time. Choosing a narrator per line or per race is a later
 * setting; hardcoding it keeps this change to the mechanism.
 */
export const NARRATOR_VOICE = "narrator-male";

export type Segment = { speaker: "npc" | "narrator"; text: string };

/**
 * A capitalised bracketed span, and nothing else.
 *
 * Blizzard writes both stage directions and NPC sounds in angle brackets, and capitalisation is
 * what separates them - across all 90 spans in the corpus, with no exceptions. A direction
 * names someone: "Eva weeps.", "Motega shrugs his shoulder". A sound is a bare lowercase word:
 * <hic>, <cough>, <sigh>, <mutters>.
 *
 * Capitalisation alone, note. Also requiring a closing full stop is tempting and wrong -
 * "Motega shrugs his shoulder" has none.
 *
 * A lowercase span is left in the NPC's text with its brackets, so the voiceability gate keeps
 * refusing the line. Those seven lines stay silent, which beats a narrator saying "hic".
 */
const DIRECTION = /(<[A-Z][^<>]*>)/;

export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  for (const piece of text.split(DIRECTION)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const direction = DIRECTION.test(trimmed) && trimmed.startsWith("<") && trimmed.endsWith(">");
    out.push({
      speaker: direction ? "narrator" : "npc",
      text: direction ? trimmed.slice(1, -1).trim() : trimmed,
    });
  }
  return out;
}

export function hasNarration(text: string): boolean {
  return segments(text).some((segment) => segment.speaker === "narrator");
}
