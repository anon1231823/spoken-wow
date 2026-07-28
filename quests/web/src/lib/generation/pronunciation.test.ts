import { describe, expect, it } from "vitest";

import { VOICE_CONFIG_DIR } from "@/lib/paths";
import { readPronunciationFile } from "./files";
import { applyPronunciation, compileRules, toJsReplacement } from "./pronunciation";

/**
 * The committed rules, and what Python produces for each case:
 *
 *   python3 -c 'from tts_cli.voice_config import apply_pronunciation, load_pronunciation; \
 *     r = load_pronunciation(); print(apply_pronunciation("Hm. hm, Hmm hmm Hmph", r))'
 */
describe("the shipped rules", () => {
  const rules = readPronunciationFile(VOICE_CONFIG_DIR);

  it("expands a bare Hm without touching Hmm or Hmph", () => {
    expect(applyPronunciation("Hm. hm, Hmm hmm Hmph", rules)).toBe("Hmm. hmm, Hmm hmm Hmph");
  });

  it("fixes every occurrence in a line, not only the first", () => {
    expect(applyPronunciation("Hm, well. Hm.", rules)).toBe("Hmm, well. Hmm.");
  });

  it("leaves text with nothing to fix byte-identical", () => {
    const text = "Greetings, traveller. The mines are not safe.";
    expect(applyPronunciation(text, rules)).toBe(text);
  });
});

describe("compileRules", () => {
  it("skips a pattern JavaScript cannot parse rather than throwing", () => {
    // Valid in Python, rejected by JS: a named group in Python's (?P<x>…) spelling. The
    // surviving rule must still be applied - one bad rule costs its own fix, not the run.
    const rules = { "(?P<word>a)": "b", c: "d" };
    expect(compileRules(rules)).toHaveLength(1);
    expect(applyPronunciation("cc", rules)).toBe("dd");
  });

  it("applies rules in declaration order, so a later rule sees the earlier edits", () => {
    expect(applyPronunciation("a", { a: "b", b: "c" })).toBe("c");
  });
});

// Python's re.sub and JavaScript's String.replace disagree about both `$` and backreferences.
// Neither shipped rule uses either, which is exactly why this needs a test - the day someone
// adds one, it should work rather than emit "$&" into a voiceline.
describe("toJsReplacement", () => {
  it("keeps a literal dollar literal", () => {
    expect(applyPronunciation("cost", { cost: "$5" })).toBe("$5");
    expect(applyPronunciation("x", { x: "$&" })).toBe("$&");
    expect(applyPronunciation("x", { x: "a$'b" })).toBe("a$'b");
  });

  it("converts Python's backreference spelling to JavaScript's", () => {
    expect(toJsReplacement("\\1")).toBe("$1");
    expect(applyPronunciation("Mr Smith", { "Mr (\\w+)": "Mister \\1" })).toBe("Mister Smith");
  });
});
