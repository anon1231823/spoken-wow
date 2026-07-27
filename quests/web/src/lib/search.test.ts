import { describe, expect, it } from "vitest";

import { loadCorpus } from "./corpus";
import { storeIndex } from "./audio";
import { GOSSIP_GROUP_TITLE, isGap, search } from "./search";

const corpus = loadCorpus();
const store = storeIndex();
const find = (options: Parameters<typeof search>[2]) => search(corpus, store, options);

describe("search by npc", () => {
  it("finds an npc by name, case-insensitively", () => {
    const result = find({ q: "dughan" });
    expect(result.npcs).toHaveLength(1);
    expect(result.npcs[0]).toMatchObject({
      npcId: 240,
      npcName: "Marshal Dughan",
      npcType: "creature",
      lineCount: 22,
    });
  });

  it("finds the same npc by id", () => {
    const byId = find({ q: "240", filter: "npc" });
    expect(byId.npcs.map((n) => n.key)).toEqual(["creature:240"]);
    expect(byId.lineCount).toBe(find({ q: "dughan" }).lineCount);
  });

  it("matches on a substring, not just a prefix", () => {
    expect(find({ q: "MARSHAL" }).npcs.some((n) => n.npcId === 240)).toBe(true);
  });
});

describe("search by quest", () => {
  it("finds every giver of a quest id", () => {
    // Quest 123 "The Collector" is accepted from an item and turned in to an NPC - the
    // case the old data-module format could not express.
    const result = find({ q: "123", filter: "quest" });
    expect(result.npcs.map((n) => n.key).sort()).toEqual(["creature:240", "item:1307"]);
  });

  it("finds a quest by title", () => {
    const result = find({ q: "The Collector", filter: "quest" });
    expect(result.npcs.map((n) => n.key).sort()).toEqual(["creature:240", "item:1307"]);
  });
});

describe("filter scoping", () => {
  it("'npc' does not match a quest id", () => {
    // No creature has id 123, so an npc-scoped search must come back empty.
    expect(find({ q: "123", filter: "npc" }).npcs).toEqual([]);
  });

  it("'any' matches either side", () => {
    expect(find({ q: "123", filter: "any" }).npcs.length).toBe(2);
    expect(find({ q: "240", filter: "any" }).npcs.some((n) => n.npcId === 240)).toBe(true);
  });
});

describe("grouping", () => {
  const dughan = find({ q: "dughan" }).npcs[0];

  it("groups lines by quest", () => {
    const collector = dughan.quests.find((g) => g.questId === 123);
    expect(collector?.title).toBe("The Collector");
    expect(collector?.lines.map((l) => l.source).sort()).toEqual(["complete", "progress"]);
  });

  it("collects gossip into its own group", () => {
    const gossip = dughan.quests.find((g) => g.questId === null);
    expect(gossip?.title).toBe(GOSSIP_GROUP_TITLE);
    expect(gossip?.lines.every((l) => l.source === "gossip")).toBe(true);
  });

  it("annotates each line with its audio path and presence", () => {
    const line = dughan.quests
      .flatMap((g) => g.lines)
      .find((l) => l.lineId === "q:123:complete")!;
    expect(line.audioPath).toBe("quests/123-complete.mp3");
    expect(line.hasAudio).toBe(store.has(line.audioPath));
  });

  it("keeps separate entity types apart", () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    const keys = find({ q: "68", filter: "npc" }).npcs.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("gaps", () => {
  it("ignores lines the generator never voices", () => {
    // Progress text is deliberately never synthesized, so its absence is not a gap.
    const progress = corpus.lines.find((l) => l.source === "progress")!;
    expect(progress.generatable).toBe(false);
    expect(isGap(progress, store)).toBe(false);
  });

  it("missingOnly returns only generatable lines with no audio", () => {
    const result = find({ q: "", missingOnly: true, limit: 10_000 });
    const lines = result.npcs.flatMap((n) => n.quests.flatMap((g) => g.lines));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.generatable && !l.hasAudio)).toBe(true);
  });
});

describe("limits", () => {
  it("caps the npcs returned and says so", () => {
    const result = find({ q: "", limit: 5 });
    expect(result.npcs).toHaveLength(5);
    expect(result.truncated).toBe(true);
    expect(result.npcCount).toBeGreaterThan(5);
  });

  it("reports the full line count even when truncated", () => {
    expect(find({ q: "", limit: 5 }).lineCount).toBe(corpus.lineCount);
  });
});
