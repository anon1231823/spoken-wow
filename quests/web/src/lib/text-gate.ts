/**
 * Which characters make a line unvoiceable.
 *
 * This was a mirror of INVALID_CHARS in tts_cli/corpus.py and is no longer one. The character
 * list still matches, but the web app now voices a capitalised stage direction by handing it to
 * a narrator (lib/generation/narration.ts), and the Python CLI cannot. A line the CLI calls
 * unvoiceable may therefore be voiceable here. That divergence is deliberate and joins the
 * other one CLAUDE.md records: the CLI sends no pronunciation dictionary either.
 *
 * The corpus's own `generatable` flag is baked in at extraction time, from text nobody could
 * edit yet. Now that a line's spoken text can be overridden - and that a direction can be
 * narrated - the same question has to be answerable here, against the text that will be sent.
 *
 * `$` starts a template token the game expands and we do not - `$2113w` is a war-effort tally,
 * `$Gmale:female;` a branch - and a model asked to read one says "dollar twenty-one thirteen
 * w". A bare `<` or `>` is a bracket nobody can speak.
 *
 * No node imports: the override dialog checks a draft before sending it, and the server checks
 * the copy that counts.
 */

/** Kept as a string, character for character, so the two files can be diffed by eye. */
export const INVALID_CHARS = "$<>";

/**
 * Capitalised stage directions, which the narrator speaks rather than the NPC.
 *
 * Lowercase spans are deliberately not matched: `<hic>` is a sound the NPC makes, nothing
 * voices it yet, and letting it through here would put the brackets into someone's mouth.
 */
const DIRECTION = /<[A-Z][^<>]*>/g;

export function hasInvalidChars(text: string): boolean {
  const spoken = text.replace(DIRECTION, "");
  return [...INVALID_CHARS].some((c) => spoken.includes(c));
}

/**
 * Whether a line would be voiced, given the text that would be sent.
 *
 * `progress` is skipped by policy - quest-in-progress text is deliberately never voiced - so
 * it is read off the corpus's own skipReason and no override can reach it. `invalid-chars` is
 * a property of the text, so it is re-decided here rather than trusted from the corpus: that
 * is what lets an override rescue the 99 lines the extractor had to give up on.
 */
export function isVoiceable(
  line: { skipReason: string | null },
  effectiveText: string,
): boolean {
  if (line.skipReason === "progress") return false;
  return !hasInvalidChars(effectiveText);
}
