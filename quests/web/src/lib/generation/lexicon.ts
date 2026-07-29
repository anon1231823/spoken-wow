/**
 * The pronunciation lexicon: what a name is, and how ElevenLabs should say it.
 *
 * Shapes and validation only, with no node:fs and no pg, for the reason config.ts has none:
 * the editor is a client component and must be able to import the types and check a draft
 * before sending it, without dragging the server's dependencies into the browser bundle.
 *
 * An entry says how a name sounds in one of two ways, and the choice is not cosmetic:
 *
 *   ipa    a phoneme rule. Exact, and honoured by eleven_v3 and eleven_flash_v2 only - every
 *          other model silently ignores it and speaks the default pronunciation.
 *   alias  a respelling. Approximate, because it is only as good as the reader's guess at
 *          the new spelling, but honoured by every model.
 *
 * Both kinds can sit in one dictionary, so a lexicon does not have to choose. What it must
 * not do is carry both for one name: ElevenLabs would apply one of them and nothing here
 * could say which.
 */

export const CONFIDENCES = ["high", "check"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CATEGORIES = ["place", "character", "lesser", "creature"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  place: "Place",
  character: "Character",
  lesser: "Lesser name",
  creature: "Creature & faction",
};

/** Models that honour phoneme rules. Everything else ignores the dictionary entirely. */
export const PHONEME_MODELS = ["eleven_v3", "eleven_flash_v2"] as const;

export function honoursPhonemes(modelId: string): boolean {
  return (PHONEME_MODELS as readonly string[]).includes(modelId);
}

export type LexiconEntry = {
  /** The word as the corpus writes it. Matched case-insensitively, so one spelling suffices. */
  grapheme: string;
  /** Exact pronunciation, for anyone who can write IPA. Exactly one of ipa and alias. */
  ipa?: string;
  /**
   * A respelling ElevenLabs reads in place of the name, for anyone who cannot.
   *
   * Written as something a reader would simply say - "nomeregan", not "NOME-reh-gan". The
   * capitals-for-stress convention is for people: sent to a model, capitals can read as an
   * acronym and hyphens as pauses, which is a worse pronunciation than the one being fixed.
   */
  alias?: string;
  /** A respelling for humans reading this page. Never sent to ElevenLabs. */
  say: string;
  confidence: Confidence;
  category: Category;
  note?: string;
};

/** Which kind of rule an entry will become. */
export function kindOf(entry: LexiconEntry): "ipa" | "alias" {
  return entry.alias ? "alias" : "ipa";
}

export class LexiconError extends Error {}

/**
 * A rule as the add-from-rules endpoint wants it.
 *
 * case_sensitive is false throughout, and it is the whole reason this app builds rules
 * rather than a PLS lexicon file: PLS matching is case-sensitive with no override,
 * and the corpus writes the same name several ways - Aku'mai and Aku'Mai, tauren and Tauren,
 * Qiraji and qiraji. That is 123 occurrences a PLS upload silently declines to fix. No
 * grapheme here collides with a word whose casing changes how it should sound.
 *
 * word_boundaries stays true, or "Caer" would fire inside "Caern".
 */
type Matching = {
  string_to_replace: string;
  case_sensitive: false;
  word_boundaries: true;
};

export type DictionaryRule =
  | (Matching & { type: "phoneme"; phoneme: string; alphabet: "ipa" })
  | (Matching & { type: "alias"; alias: string });

export function toRules(entries: LexiconEntry[]): DictionaryRule[] {
  return entries.map((entry) => {
    const matching: Matching = {
      string_to_replace: entry.grapheme,
      case_sensitive: false,
      word_boundaries: true,
    };
    return entry.alias
      ? { ...matching, type: "alias", alias: entry.alias }
      : { ...matching, type: "phoneme", phoneme: entry.ipa!, alphabet: "ipa" };
  });
}

/** A trimmed value, or "" when the field is absent, blank, or not a string. */
function optional(raw: Record<string, unknown>, key: string): string {
  return typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
}

function text(raw: Record<string, unknown>, key: string, where: string): string {
  const value = raw[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new LexiconError(`${where}: ${key} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Coerce and check one untrusted entry, or throw LexiconError.
 *
 * The grapheme is trimmed but never case-folded. It is what the editor displays and what a
 * reviewer matches against the corpus by eye, so "Kel'Thuzad" has to stay "Kel'Thuzad" -
 * case-insensitivity is a property of the rule ElevenLabs applies, not of the record here.
 */
export function validateEntry(input: unknown, index: number): LexiconEntry {
  const where = `entry ${index}`;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LexiconError(`${where} must be an object`);
  }
  const raw = input as Record<string, unknown>;

  const grapheme = text(raw, "grapheme", where);

  // A grapheme with a space would need the rule to match across a word boundary the API
  // treats as a separator, so it would simply never fire. Rejecting it is kinder than
  // storing a rule that does nothing.
  if (/\s/.test(grapheme)) {
    throw new LexiconError(`${where}: "${grapheme}" contains a space, which never matches`);
  }

  // Exactly one, never both. ElevenLabs would apply one of a phoneme and an alias rule for
  // the same word and nothing on the editor page could say which, so an entry carrying both
  // is an entry whose pronunciation is unknowable.
  const ipa = optional(raw, "ipa");
  const alias = optional(raw, "alias");
  if (ipa && alias) {
    throw new LexiconError(
      `${where}: "${grapheme}" has both IPA and a respelling; give it one or the other`,
    );
  }
  if (!ipa && !alias) {
    throw new LexiconError(`${where}: "${grapheme}" needs either IPA or a respelling`);
  }

  // IPA delimiters are a human convention for writing pronunciations down; ElevenLabs wants
  // the bare phonemes and would try to pronounce a slash.
  if (ipa && /[/[\]]/.test(ipa)) {
    throw new LexiconError(`${where}: IPA for "${grapheme}" must not include / or [ ]`);
  }

  // An alias is read aloud as written, so the conventions that make a respelling legible on
  // this page make it worse as speech: capitals can read as an acronym, and a hyphen as a
  // pause. "nomeregan" is a pronunciation; "NOME-reh-gan" is a note about one.
  if (alias && /[A-Z]{2,}/.test(alias)) {
    throw new LexiconError(
      `${where}: respell "${grapheme}" as it should be said, not in stress capitals`,
    );
  }

  const confidence = raw.confidence;
  if (!(CONFIDENCES as readonly unknown[]).includes(confidence)) {
    throw new LexiconError(`${where}: unknown confidence ${JSON.stringify(confidence)}`);
  }

  const category = raw.category;
  if (!(CATEGORIES as readonly unknown[]).includes(category)) {
    throw new LexiconError(`${where}: unknown category ${JSON.stringify(category)}`);
  }

  const entry: LexiconEntry = {
    grapheme,
    say: typeof raw.say === "string" ? raw.say.trim() : "",
    confidence: confidence as Confidence,
    category: category as Category,
  };
  if (ipa) entry.ipa = ipa;
  if (alias) entry.alias = alias;
  if (typeof raw.note === "string" && raw.note.trim()) entry.note = raw.note.trim();
  return entry;
}

/**
 * Coerce and check a whole lexicon, or throw LexiconError.
 *
 * Duplicate graphemes are rejected rather than deduplicated. Two rules for one word means
 * ElevenLabs picks one and nothing on this page can say which, so a lexicon that contains
 * both is not a lexicon anyone can reason about. Compared case-insensitively, because the
 * rules themselves are.
 */
export function validateLexicon(input: unknown): LexiconEntry[] {
  if (!Array.isArray(input)) throw new LexiconError("expected an array of entries");
  if (input.length === 0) {
    throw new LexiconError("a lexicon with no entries would be a dictionary that says nothing");
  }

  const entries = input.map(validateEntry);

  const seen = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.grapheme.toLowerCase();
    const first = seen.get(key);
    if (first !== undefined) {
      throw new LexiconError(
        `"${entry.grapheme}" and "${first}" are the same rule; matching ignores case`,
      );
    }
    seen.set(key, entry.grapheme);
  }

  return entries;
}
