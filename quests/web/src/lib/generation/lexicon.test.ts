import { describe, expect, it } from "vitest";

import {
  honoursPhonemes,
  kindOf,
  LexiconError,
  toRules,
  validateEntry,
  validateLexicon,
} from "./lexicon";

// The shape the editor sends. Every entry, every time, matching validateConfig's whole-object
// semantics: a partial update against a lexicon read a moment earlier is how two admins
// silently overwrite each other.
const ENTRY = {
  grapheme: "Gnomeregan",
  ipa: "ˈnoʊmɹəɡæn",
  say: "NOME-reh-gan",
  confidence: "high",
  category: "place",
  note: "silent G",
};

describe("validateEntry", () => {
  it("accepts a full entry", () => {
    expect(validateEntry(ENTRY, 0)).toEqual(ENTRY);
  });

  it("keeps the grapheme's case", () => {
    // The grapheme is what a reviewer matches against the corpus by eye. Case-insensitivity
    // is a property of the rule ElevenLabs applies, not of the record.
    expect(validateEntry({ ...ENTRY, grapheme: "Kel'Thuzad" }, 0).grapheme).toBe("Kel'Thuzad");
  });

  it("trims, and drops an empty note rather than storing one", () => {
    const entry = validateEntry({ ...ENTRY, grapheme: "  Thrall  ", note: "   " }, 0);
    expect(entry.grapheme).toBe("Thrall");
    expect(entry).not.toHaveProperty("note");
  });

  it("defaults a missing respelling to empty, since it is never sent to ElevenLabs", () => {
    const { say: _say, ...withoutSay } = ENTRY;
    expect(validateEntry(withoutSay, 0).say).toBe("");
  });

  // A rule whose match string contains a space can never fire, because the API bounds a rule
  // at word boundaries. Storing it would be storing a rule that does nothing.
  it("rejects a grapheme containing a space", () => {
    expect(() => validateEntry({ ...ENTRY, grapheme: "Dun Morogh" }, 3)).toThrow(LexiconError);
    expect(() => validateEntry({ ...ENTRY, grapheme: "Dun Morogh" }, 3)).toThrow(/entry 3/);
  });

  // /ˈnoʊmɹəɡæn/ is how a pronunciation is written down for people. ElevenLabs wants the bare
  // phonemes and would otherwise try to pronounce the slashes.
  it("rejects IPA wrapped in delimiters", () => {
    expect(() => validateEntry({ ...ENTRY, ipa: "/ˈnoʊmɹəɡæn/" }, 0)).toThrow(LexiconError);
    expect(() => validateEntry({ ...ENTRY, ipa: "[noʊm]" }, 0)).toThrow(LexiconError);
  });

  it("rejects an empty grapheme", () => {
    expect(() => validateEntry({ ...ENTRY, grapheme: "  " }, 0)).toThrow(/grapheme/);
  });

  // Blanking the IPA does not leave an entry with no pronunciation; it leaves an entry that
  // has neither of the two ways of giving one, which is the error worth reporting.
  it("rejects an entry whose only pronunciation has been blanked", () => {
    expect(() => validateEntry({ ...ENTRY, ipa: "" }, 0)).toThrow(/either IPA or a respelling/);
  });

  it("rejects an unknown confidence or category", () => {
    expect(() => validateEntry({ ...ENTRY, confidence: "probably" }, 0)).toThrow(/confidence/);
    expect(() => validateEntry({ ...ENTRY, category: "dungeon" }, 0)).toThrow(/category/);
  });

  it("names the index, so the editor can say which entry is wrong", () => {
    expect(() => validateEntry(null, 7)).toThrow(/entry 7/);
  });
});

describe("validateLexicon", () => {
  it("accepts a list", () => {
    expect(validateLexicon([ENTRY])).toEqual([ENTRY]);
  });

  it("rejects anything that is not an array", () => {
    expect(() => validateLexicon({ entries: [ENTRY] })).toThrow(LexiconError);
  });

  // Not merely useless: an empty lexicon would upload a dictionary with no rules and read as
  // a successful save, so every name would quietly revert with nothing on the page to say so.
  it("rejects an empty lexicon", () => {
    expect(() => validateLexicon([])).toThrow(LexiconError);
  });

  // Two rules for one word means ElevenLabs picks one and nothing on the page can say which.
  it("rejects duplicates, comparing the way the rules match", () => {
    const clash = [ENTRY, { ...ENTRY, grapheme: "gnomeregan", ipa: "ɡnoʊmˈɹɛɡən" }];
    expect(() => validateLexicon(clash)).toThrow(/same rule/);
  });

  it("allows two entries that differ by more than case", () => {
    expect(validateLexicon([ENTRY, { ...ENTRY, grapheme: "Gnomeregans" }])).toHaveLength(2);
  });
});

// The other way to say how a name sounds, for anyone who cannot write IPA. Approximate, but
// honoured by every model rather than only by eleven_v3 and eleven_flash_v2.
const RESPELLED = {
  grapheme: "Gnomeregan",
  alias: "nomeregan",
  say: "NOME-reh-gan",
  confidence: "high" as const,
  category: "place" as const,
};

describe("respelled entries", () => {
  it("accepts an entry with a respelling instead of IPA", () => {
    expect(validateEntry(RESPELLED, 0)).toEqual(RESPELLED);
    expect(kindOf(validateEntry(RESPELLED, 0))).toBe("alias");
  });

  // ElevenLabs would apply one of the two and nothing on the editor page could say which.
  it("rejects an entry carrying both", () => {
    expect(() => validateEntry({ ...RESPELLED, ipa: "ˈnoʊmɹəɡæn" }, 0)).toThrow(/one or the other/);
  });

  it("rejects an entry carrying neither", () => {
    const { alias: _alias, ...neither } = RESPELLED;
    expect(() => validateEntry(neither, 0)).toThrow(/either IPA or a respelling/);
  });

  /**
   * An alias is read aloud as written, so the conventions that make a respelling legible to
   * a person make it worse as speech: capitals can read as an acronym, a hyphen as a pause.
   * The stress-capitals form belongs in `say`, which is never sent.
   */
  it("rejects a respelling written in stress capitals", () => {
    expect(() => validateEntry({ ...RESPELLED, alias: "NOME-reh-gan" }, 0)).toThrow(
      /not in stress capitals/,
    );
  });

  it("keeps a leading capital, which is ordinary spelling rather than stress", () => {
    expect(validateEntry({ ...RESPELLED, alias: "Nomeregan" }, 0).alias).toBe("Nomeregan");
  });

  it("lets one lexicon hold both kinds", () => {
    const mixed = validateLexicon([ENTRY, { ...RESPELLED, grapheme: "Cairne", alias: "cairn" }]);
    expect(mixed.map(kindOf)).toEqual(["ipa", "alias"]);
  });
});

describe("toRules", () => {
  /**
   * case_sensitive: false is the whole reason this app builds rules rather than uploading
   * voice/lexicon.pls. PLS matching is case-sensitive with no override, and the corpus writes
   * the same name several ways - Aku'mai and Aku'Mai, tauren and Tauren, Qiraji and qiraji.
   */
  it("emits case-insensitive, word-bounded phoneme rules", () => {
    expect(toRules(validateLexicon([ENTRY]))).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "phoneme",
        phoneme: "ˈnoʊmɹəɡæn",
        alphabet: "ipa",
        case_sensitive: false,
        word_boundaries: true,
      },
    ]);
  });

  it("emits an alias rule for a respelled entry", () => {
    expect(toRules(validateLexicon([RESPELLED]))).toEqual([
      {
        string_to_replace: "Gnomeregan",
        type: "alias",
        alias: "nomeregan",
        case_sensitive: false,
        word_boundaries: true,
      },
    ]);
  });

  it("does not send the human respelling or the note", () => {
    const [rule] = toRules(validateLexicon([ENTRY]));
    expect(rule).not.toHaveProperty("say");
    expect(rule).not.toHaveProperty("note");
  });

  // `say` is the stress-capitals form for readers of the editor; `alias` is what a model is
  // asked to read. Conflating them would send "NOME-REH-GAN" to be spoken.
  it("never sends `say` as an alias", () => {
    const [rule] = toRules(validateLexicon([RESPELLED]));
    expect(rule).toMatchObject({ alias: "nomeregan" });
  });
});

describe("honoursPhonemes", () => {
  // The whole feature is inert on any other model: ElevenLabs skips phoneme rules silently
  // and speaks the default pronunciation, so the editor has to warn rather than imply a save
  // took effect.
  it("knows which models honour a phoneme rule", () => {
    expect(honoursPhonemes("eleven_v3")).toBe(true);
    expect(honoursPhonemes("eleven_flash_v2")).toBe(true);
    expect(honoursPhonemes("eleven_multilingual_v2")).toBe(false);
    expect(honoursPhonemes("eleven_turbo_v2_5")).toBe(false);
  });
});
