// Reading the shared pronunciation dictionary, and asking whether it covers this
// project's text.
//
// The lexicon is owned by ../wow-voiceover: it is edited there, uploaded there,
// and reaches this project only as rules the model applies. That leaves one gap
// worth checking. A phoneme rule cannot be case-insensitive -- ElevenLabs
// discards one that tries -- so voiceover uploads a separate rule for every
// spelling **its own** corpus contains. A name this project's lore text
// capitalises differently therefore has no rule, and is read the wrong way with
// nothing anywhere reporting it.
//
// Alias rules have no such problem: they are case-insensitive, so one covers
// every spelling.

// <lexeme><grapheme>Kalimdor</grapheme><phoneme>...</phoneme></lexeme>, with
// alias in place of phoneme for a respelling.
const LEXEME = /<lexeme>\s*<grapheme>([^<]*)<\/grapheme>\s*<(phoneme|alias)>/g;

/** The rules in a PLS document, split by the kind of matching they do. */
export function parseDictionary(pls) {
  const phonemes = new Set();
  const aliases = new Set();

  for (const [, grapheme, kind] of pls.matchAll(LEXEME)) {
    if (kind === "phoneme") phonemes.add(grapheme);
    else aliases.add(grapheme.toLowerCase());
  }
  return { phonemes, aliases };
}

// Word-bounded and case-insensitive, matching how the rules themselves match.
// The apostrophe in the lookbehind keeps "Thuzad" from matching inside
// "Kel'Thuzad", which the dictionary carries as one grapheme.
function bounded(grapheme) {
  const escaped = grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "gi");
}

/**
 * Spellings this project's text uses that no rule in the dictionary matches.
 *
 * Returns one row per uncovered spelling, most frequent first, so the report can
 * say which of them is worth an entry in voiceover's editor first.
 */
export function uncoveredSpellings({ phonemes, aliases }, texts) {
  // One needle per grapheme, keyed case-insensitively: `Forsaken` and `forsaken`
  // are two rules for one name, and scanning for each separately would report
  // the other as missing.
  const needles = new Map();
  for (const grapheme of phonemes) {
    const key = grapheme.toLowerCase();
    if (!needles.has(key)) needles.set(key, { key, pattern: bounded(grapheme) });
  }

  const counts = new Map();
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const needle of needles.values()) {
      // A substring test rejects almost every line far faster than the regex
      // does, and almost every line contains none of these names.
      if (!lower.includes(needle.key)) continue;
      needle.pattern.lastIndex = 0;
      for (const [spelling] of text.matchAll(needle.pattern)) {
        if (phonemes.has(spelling) || aliases.has(spelling.toLowerCase())) continue;
        counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
      }
    }
  }

  return [...counts]
    .map(([spelling, occurrences]) => ({ spelling, occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences);
}
