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
 * A lowercase span stays with the NPC and is handed to audioTags instead: the NPC performs the
 * sound, nobody narrates the word.
 */
const DIRECTION = /(<[A-Z][^<>]*>)/;

/** A lowercase bracketed span: a sound the NPC makes, not the game narrating. */
const SOUND = /<([a-z][^<>]*)>/g;

/**
 * The NPC's own sounds, rewritten into ElevenLabs' audio-tag syntax.
 *
 * Blizzard writes them in angle brackets - `<hic>`, `<cough>`, `<sigh>`, `<mutters>` - and
 * ElevenLabs writes them in square ones. eleven_v3, the default everywhere, performs a tag
 * rather than reading it; the angle-bracket form is not syntax to any model and would be
 * spoken aloud or refused by the gate.
 *
 * Applied to the whole line before segments(), so it reaches the single-voice path too: a line
 * whose only bracket is a sound never goes near the dialogue endpoint. Capitalised directions
 * are left untouched for segments() to hand to the narrator, and an unbalanced bracket is left
 * as damage for the gate to refuse.
 */
export function audioTags(text: string): string {
  return text.replace(SOUND, "[$1]");
}

/**
 * The accent direction for a race, prefixed to the words the NPC says.
 *
 * Dwarves are the reason this exists: the game's actors play them with a strong Scottish
 * brogue, and an instant clone read by eleven_v3 returns something closer to RP. The model
 * has no other channel for direction - a text-to-speech request carries text, settings and a
 * seed, nothing else - so the direction has to travel inside the text.
 *
 * Applied per stretch of speech rather than once at the front, because a line can be
 * interrupted by a stage direction that `narrator-male` reads. Tagging the whole string would
 * tell the narrator to sound like a dwarf too, and would leave the second half of the NPC's
 * own speech untagged.
 *
 * Runs after audioTags, so the sounds it rewrote are square-bracketed by now and stay with
 * the speech that makes them. Angle brackets are still what separates a direction from
 * speech here, and an unbalanced one is left as damage for the gate to refuse.
 */
export function accentTagged(text: string, tag: string | undefined): string {
  if (!tag) return text;
  return text
    .split(DIRECTION)
    .map((piece) =>
      DIRECTION.test(piece) || !piece.trim()
        ? piece
        : piece.replace(/^(\s*)/, `$1${tag} `),
    )
    .join("");
}

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

/**
 * Whether an override only puts stage directions back, changing no words.
 *
 * The pipeline stripped 314 directions before synthesis and they were restored as overrides,
 * which made every one of those lines look hand-rewritten. They are not: the text is
 * Blizzard's own, with a sentence the pipeline had deleted put back. Someone reviewing
 * rewrites wants the lines a human made a judgement about - "adventurerama", the war-effort
 * tallies, the line that is the single letter "x" - not these.
 *
 * Derived rather than recorded, so it needs no column and cannot drift: edit the words of a
 * restored line and it becomes a rewrite, and starts saying so.
 */
export function restoresOnlyNarration(overrideText: string, corpusText: string): boolean {
  return overrideText.replace(/<[A-Z][^<>]*>/g, "").replace(/\s+/g, " ").trim() ===
    corpusText.replace(/\s+/g, " ").trim();
}
