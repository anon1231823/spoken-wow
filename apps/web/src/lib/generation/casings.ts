/**
 * Every spelling of a lexicon name that the corpus actually contains.
 *
 * This exists because a phoneme rule cannot be case-insensitive. ElevenLabs discards one
 * carrying case_sensitive:false without saying so, which means a name the corpus writes more
 * than one way needs a rule per way - and guessing at the ways would be both wasteful and
 * wrong. The corpus knows: `Qiraji` and `qiraji`, `tauren` and `Tauren`, `Forsaken` and
 * `forsaken` and `FORSAKEN`.
 *
 * Only spellings that occur are emitted. Generating the plausible casings of 134 names would
 * be several hundred rules for pronunciations no line will ever need, and a dictionary is
 * easier to reason about when every rule in it can fire.
 */
import { loadCorpus, type CorpusLine } from "@/lib/corpus";

/** Case-insensitive and word-bounded, matching how the rules themselves match. */
function bounded(grapheme: string): RegExp {
  const escaped = grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w'])${escaped}(?![\\w])`, "gi");
}

/**
 * grapheme -> the spellings the corpus uses, most frequent first.
 *
 * One pass with a lower-cased `includes` prefilter before the regex, for the reason
 * scanSentences has one: almost every line contains none of these names, and a substring
 * test rejects it far faster than a lookbehind does.
 */
export function scanCasings(
  graphemes: string[],
  lines: CorpusLine[],
): Record<string, string[]> {
  const needles = graphemes.map((grapheme) => ({
    grapheme,
    lower: grapheme.toLowerCase(),
    pattern: bounded(grapheme),
  }));

  const counts = new Map<string, Map<string, number>>(
    graphemes.map((grapheme) => [grapheme, new Map()]),
  );

  for (const line of lines) {
    if (!line.generatable) continue;
    const lower = line.text.toLowerCase();

    for (const needle of needles) {
      if (!lower.includes(needle.lower)) continue;
      // Reset because the pattern is global and therefore stateful; matchAll would allocate
      // a fresh iterator per line per name, which is the hot path here.
      needle.pattern.lastIndex = 0;
      for (const match of line.text.matchAll(needle.pattern)) {
        const seen = counts.get(needle.grapheme)!;
        seen.set(match[0], (seen.get(match[0]) ?? 0) + 1);
      }
    }
  }

  return Object.fromEntries(
    graphemes.map((grapheme) => [
      grapheme,
      [...counts.get(grapheme)!.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([spelling]) => spelling),
    ]),
  );
}

const key = Symbol.for("wow-voiceover.grapheme-casings");
type Memo = { lines: CorpusLine[]; casings: Record<string, string[]> };
type Holder = { [key]?: Memo };

/**
 * Casings for the current lexicon, scanning only for names not already known.
 *
 * Memoised on globalThis the way sampleSentences is, and tied to the identity of the lines it
 * was built from: the corpus ships inside the release and cannot change under a running
 * process, but a test passes a fresh array per case and must not be answered from another.
 */
export function graphemeCasings(graphemes: string[]): Record<string, string[]> {
  const lines = loadCorpus().lines;
  const holder = globalThis as Holder;

  let memo = holder[key];
  if (!memo || memo.lines !== lines) memo = holder[key] = { lines, casings: {} };

  const missing = graphemes.filter((grapheme) => !(grapheme in memo!.casings));
  if (missing.length > 0) Object.assign(memo.casings, scanCasings(missing, lines));

  return Object.fromEntries(graphemes.map((g) => [g, memo!.casings[g]]));
}
