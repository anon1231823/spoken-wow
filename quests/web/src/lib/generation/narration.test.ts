import { describe, expect, it } from "vitest";

import { audioTags, hasNarration, restoresOnlyNarration, segments } from "./narration";

describe("audioTags", () => {
  it("turns a lowercase sound into the tag syntax ElevenLabs performs", () => {
    expect(audioTags("Take some coin... <hic>... some new armor")).toBe(
      "Take some coin... [hic]... some new armor",
    );
  });

  it("converts every sound in a line", () => {
    expect(audioTags("Ye're brave... <cough>... fer me. <cough>")).toBe(
      "Ye're brave... [cough]... fer me. [cough]",
    );
  });

  it("leaves a capitalised direction alone, because the narrator reads it", () => {
    expect(audioTags("Hm. <cough> <He turns away.>")).toBe("Hm. [cough] <He turns away.>");
  });

  it("leaves an unbalanced bracket alone rather than guessing", () => {
    expect(audioTags("What < is this")).toBe("What < is this");
  });
});

describe("segments", () => {
  it("splits speech from a trailing direction", () => {
    expect(segments("Excellent.\n\n<He opens the note.>")).toEqual([
      { speaker: "npc", text: "Excellent." },
      { speaker: "narrator", text: "He opens the note." },
    ]);
  });

  it("keeps reading order when a direction comes first", () => {
    expect(segments("<Sirra begins translating.>\n\nThere we are.")).toEqual([
      { speaker: "narrator", text: "Sirra begins translating." },
      { speaker: "npc", text: "There we are." },
    ]);
  });

  it("handles a line that is nothing but a direction", () => {
    expect(segments("<Sirra begins translating the note...>")).toEqual([
      { speaker: "narrator", text: "Sirra begins translating the note..." },
    ]);
  });

  it("alternates through more than one direction", () => {
    const parts = segments("One. <A pause.> Two. <A longer pause.>");
    expect(parts.map((p) => p.speaker)).toEqual(["npc", "narrator", "npc", "narrator"]);
  });

  it("returns one npc segment when there is no direction", () => {
    expect(segments("Just talking.")).toEqual([{ speaker: "npc", text: "Just talking." }]);
  });

  it("leaves an unbalanced bracket in the spoken text rather than guessing", () => {
    // The gate refuses this line anyway; inventing a closing bracket here would hide that.
    expect(segments("What < is this")).toEqual([{ speaker: "npc", text: "What < is this" }]);
  });

  it("leaves a lowercase sound with the npc", () => {
    // <hic> is the dwarf hiccuping, not the game narrating. Handing it to a narrator would have
    // a second voice say "hic". audioTags has usually turned it into [hic] before this runs;
    // either way it stays in the NPC's own turn.
    expect(segments("Take some coin... <hic>... some new armor")).toEqual([
      { speaker: "npc", text: "Take some coin... <hic>... some new armor" },
    ]);
  });

  it("splits on the capital, not on the bracket", () => {
    // Capitalisation is the whole rule: a direction names someone, a sound does not.
    expect(segments("Hm. <cough> <He turns away.>")).toEqual([
      { speaker: "npc", text: "Hm. <cough>" },
      { speaker: "narrator", text: "He turns away." },
    ]);
  });

  it("keeps a direction with no full stop, which the corpus has", () => {
    // "Motega shrugs his shoulder" is why the rule is capitalisation and not punctuation.
    expect(segments("<Motega shrugs his shoulder>")).toEqual([
      { speaker: "narrator", text: "Motega shrugs his shoulder" },
    ]);
  });

  it("drops whitespace-only pieces", () => {
    expect(segments("  <A pause.>  ")).toEqual([{ speaker: "narrator", text: "A pause." }]);
  });
});

describe("hasNarration", () => {
  it("is true only for a capitalised, well-formed direction", () => {
    expect(hasNarration("Hello <He waves.> there")).toBe(true);
    expect(hasNarration("Hello there")).toBe(false);
    expect(hasNarration("What < is this")).toBe(false);
    expect(hasNarration("Ye're brave... <cough>...")).toBe(false);
  });
});

describe("restoresOnlyNarration", () => {
  const corpus = "A crystal fragment.";

  it("is true when only a direction was put back", () => {
    expect(restoresOnlyNarration("<He turns it over.>\n\nA crystal fragment.", corpus)).toBe(true);
  });

  it("is false when a word changed as well", () => {
    expect(restoresOnlyNarration("<He turns it over.>\n\nA crystal shard.", corpus)).toBe(false);
  });

  it("is false for an ordinary rewrite with no direction at all", () => {
    // The rewrites worth reviewing: a $ token turned into words, "adventurerama", the line
    // that is the single letter "x".
    expect(restoresOnlyNarration("Plenty of leather.", corpus)).toBe(false);
  });

  it("ignores whitespace, which the strip leaves behind unevenly", () => {
    expect(restoresOnlyNarration("<He turns it over.>   A crystal   fragment.", corpus)).toBe(true);
  });
});
