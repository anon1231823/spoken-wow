/**
 * Normalizing text for speech.
 *
 * A port of apply_pronunciation in tts_cli/voice_config.py, applied to the spoken string
 * only. Filenames derive from originalText, so nothing here can change which file is
 * written - that separation is what makes a pronunciation fix safe to apply to audio that
 * has already shipped.
 *
 * The rules are Python `re` patterns being handed to JavaScript's RegExp. The two flavours
 * agree on everything the shipped rules use, but not on everything: a pattern JS rejects is
 * skipped with a warning rather than thrown, because one bad rule must not take the whole
 * generator down.
 */

export type Rule = { pattern: RegExp; replacement: string };

/**
 * Translate a Python replacement template into a JavaScript one.
 *
 * The two disagree in both directions. Python treats `$` as an ordinary character while
 * String.replace reads `$&`, `$'` and `$1` as substitutions, so every `$` is escaped. Python
 * spells a backreference `\1` where JavaScript spells it `$1`, so those are converted - the
 * escaping runs first, or the `$` this introduces would be escaped in turn.
 */
export function toJsReplacement(replacement: string): string {
  return replacement.replace(/\$/g, "$$$$").replace(/\\(\d)/g, "$$$1");
}

/**
 * Compile the rule map, dropping anything JS cannot parse.
 *
 * Global, because Python's re.sub replaces every occurrence and a non-global RegExp would
 * silently fix only the first "Hm" in a line.
 */
export function compileRules(rules: Record<string, string>): Rule[] {
  const compiled: Rule[] = [];
  for (const [source, replacement] of Object.entries(rules)) {
    try {
      compiled.push({ pattern: new RegExp(source, "g"), replacement: toJsReplacement(replacement) });
    } catch (error) {
      console.warn(`skipping pronunciation rule ${JSON.stringify(source)}:`, error);
    }
  }
  return compiled;
}

/** Apply rules in declaration order, as Python does - a later rule sees the earlier edits. */
export function applyRules(text: string, rules: Rule[]): string {
  return rules.reduce(
    // `pattern` is global and therefore stateful; String.replace resets lastIndex itself,
    // but only because it is called with a global regex - do not "optimise" this to exec.
    (current, rule) => current.replace(rule.pattern, rule.replacement),
    text,
  );
}

export function applyPronunciation(text: string, rules: Record<string, string>): string {
  return applyRules(text, compileRules(rules));
}
