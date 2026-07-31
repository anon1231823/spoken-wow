/**
 * Which characters make a line unvoiceable.
 *
 * A mirror of INVALID_CHARS in tts_cli/corpus.py, and it has to be one: that module bakes a
 * `generatable` flag into the corpus at extraction time, from text nobody could edit yet. Now
 * that a line's spoken text can be overridden, the same question has to be answerable here,
 * against the text that will actually be sent.
 *
 * They are unvoiceable for the same reason in both places. `$` starts a template token the
 * game expands and we do not - `$2113w` is a war-effort tally, `$Gmale:female;` a branch - and
 * a model asked to read one says "dollar twenty-one thirteen w". `<` and `>` wrap stage
 * directions written for a reader, not a speaker: `<Thrall grunts.>`.
 *
 * No node imports: the override dialog checks a draft before sending it, and the server
 * checks the copy that counts.
 */

/** Kept as a string, character for character, so the two files can be diffed by eye. */
export const INVALID_CHARS = "$<>";

export function hasInvalidChars(text: string): boolean {
  return [...INVALID_CHARS].some((c) => text.includes(c));
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
