import { describe, expect, it } from "vitest";

import { loadCorpus, npcKey } from "./corpus";
import { storeIndex } from "./audio";
import { batchJobs, isGap, matchingLines, search } from "./search";

const corpus = loadCorpus();
const store = storeIndex();
const find = (options: Parameters<typeof search>[2]) => search(corpus, store, options);
/** The whole result rather than a page, for assertions about the match set itself. */
const all = (options: Parameters<typeof search>[2] = {}) =>
  find({ ...options, limit: 20_000 }).lines;

const npcKeys = (lines: { npcType: "creature" | "gameobject" | "item"; npcId: number }[]) =>
  [...new Set(lines.map(npcKey))].sort();

describe("search by npc", () => {
  it("finds an npc by name, case-insensitively", () => {
    const result = find({ q: "dughan", filter: "npc", limit: 20_000 });
    expect(npcKeys(result.lines)).toEqual(["creature:240"]);
    expect(result.npcCount).toBe(1);
    expect(result.total).toBe(22);
  });

  it("finds the same npc by id", () => {
    const byId = find({ q: "240", filter: "npc", limit: 20_000 });
    expect(npcKeys(byId.lines)).toEqual(["creature:240"]);
    expect(byId.total).toBe(find({ q: "dughan", filter: "npc" }).total);
  });

  it("matches on a substring, not just a prefix", () => {
    expect(all({ q: "MARSHAL", filter: "npc" }).some((l) => l.npcId === 240)).toBe(true);
  });

  it("is widened by 'any', which also reads what other npcs say about them", () => {
    // The scope dropdown exists for exactly this: "dughan" unscoped now brings in lines that
    // merely mention him, which is usually welcome and occasionally not.
    expect(all({ q: "dughan" }).length).toBeGreaterThan(all({ q: "dughan", filter: "npc" }).length);
  });
});

describe("search by quest", () => {
  it("finds every giver of a quest id", () => {
    // Quest 123 "The Collector" is accepted from an item and turned in to an NPC - the
    // case the old data-module format could not express.
    expect(npcKeys(all({ q: "123", filter: "quest" }))).toEqual(["creature:240", "item:1307"]);
  });

  it("finds a quest by title", () => {
    expect(npcKeys(all({ q: "The Collector", filter: "quest" }))).toEqual([
      "creature:240",
      "item:1307",
    ]);
  });
});

describe("search by line text", () => {
  // A phrase from one line of Marshal Dughan's, and from nothing else in the corpus. His
  // name is what makes it a real test of scoping: an npc-scoped search still finds his
  // other lines by name, so only a phrase absent from every name can prove text is read.
  const phrase = "murlocs are true";

  it("finds a line by what it says", () => {
    const lines = all({ q: phrase, filter: "text" });
    expect(lines.map((l) => l.lineId)).toEqual(["q:35:accept"]);
  });

  it("is included in 'any'", () => {
    expect(all({ q: phrase }).map((l) => l.lineId)).toEqual(["q:35:accept"]);
  });

  it("is not read by the npc or quest filters", () => {
    expect(all({ q: phrase, filter: "npc" })).toEqual([]);
    expect(all({ q: phrase, filter: "quest" })).toEqual([]);
  });

  it("treats a number as a substring rather than an id", () => {
    // The id branch is what "any" uses for a bare number, and it is deliberately not shared:
    // scoped to text, "12" means the characters, not quest 12.
    const lines = all({ q: "12", filter: "text" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.text.includes("12"))).toBe(true);
  });
});

describe("filter scoping", () => {
  it("'npc' does not match a quest id", () => {
    // No creature has id 123, so an npc-scoped search must come back empty.
    expect(all({ q: "123", filter: "npc" })).toEqual([]);
  });

  it("'any' matches either side", () => {
    expect(npcKeys(all({ q: "123" })).length).toBe(2);
    expect(all({ q: "240" }).some((l) => l.npcId === 240)).toBe(true);
  });
});

describe("field filters", () => {
  it("narrows to a race", () => {
    const lines = all({ race: "tauren" });
    expect(lines).toHaveLength(2064);
    expect(lines.every((l) => l.race === "tauren")).toBe(true);
  });

  it("intersects rather than widening", () => {
    const both = all({ race: "tauren", gender: "female" });
    expect(both).toHaveLength(630);
    expect(both.length).toBeLessThan(all({ race: "tauren" }).length);
    expect(both.every((l) => l.race === "tauren" && l.gender === "female")).toBe(true);
  });

  it("filters by voice, source and entity type", () => {
    // A voice is race-gender-flavor, so it narrows within the pair rather than matching it:
    // tauren-female speaks with three different voices.
    expect(all({ voice: "tauren-female-shaman" })).toHaveLength(145);
    expect(all({ voice: "tauren-female-shaman" }).every((l) => l.race === "tauren")).toBe(true);
    expect(all({ source: "gossip" }).every((l) => l.source === "gossip")).toBe(true);
    expect(all({ npcType: "item" }).every((l) => l.npcType === "item")).toBe(true);
  });

  it("combines with a query", () => {
    const lines = all({ q: "dughan", filter: "npc", source: "gossip" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.npcId === 240 && l.source === "gossip")).toBe(true);
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
    const lines = all({ missingOnly: true });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.generatable && !l.hasAudio)).toBe(true);
  });
});

describe("annotation", () => {
  it("gives each line its audio path and presence", () => {
    const line = all({ q: "dughan", filter: "npc" }).find((l) => l.lineId === "q:123:complete")!;
    expect(line.audioPath).toBe("quests/123-complete.mp3");
    expect(line.hasAudio).toBe(store.has(line.audioPath));
  });
});

describe("paging", () => {
  it("reports the whole match set, not the page", () => {
    const page = find({});
    expect(page.lines).toHaveLength(50);
    expect(page.total).toBe(corpus.lineCount);
    expect(page.npcCount).toBeGreaterThan(2_000);
  });

  it("does not repeat or skip a line between pages", () => {
    const first = find({ limit: 50, offset: 0 }).lines;
    const second = find({ limit: 50, offset: 50 }).lines;
    const straight = find({ limit: 100, offset: 0 }).lines;

    expect([...first, ...second].map((l) => l.key)).toEqual(straight.map((l) => l.key));
  });

  it("keeps the total stable across pages", () => {
    expect(find({ offset: 0 }).total).toBe(find({ offset: 500 }).total);
  });

  it("ends with a short page rather than an empty one", () => {
    const last = Math.floor((corpus.lineCount - 1) / 50) * 50;
    const page = find({ offset: last });
    expect(page.lines.length).toBeGreaterThan(0);
    expect(page.lines.length).toBeLessThanOrEqual(50);
    expect(find({ offset: last + 50 }).lines).toEqual([]);
  });

  it("orders deterministically, or paging would drop lines", () => {
    expect(find({ offset: 300 }).lines.map((l) => l.key)).toEqual(
      find({ offset: 300 }).lines.map((l) => l.key),
    );
  });

  it("keeps an npc's lines together", () => {
    const lines = all({ q: "dughan", filter: "npc" });
    expect(lines.map((l) => l.npcName)).toEqual(Array(lines.length).fill("Marshal Dughan"));
    // Gossip has no quest and sorts after every quest that does.
    const firstGossip = lines.findIndex((l) => l.questId === null);
    expect(lines.slice(firstGossip).every((l) => l.questId === null)).toBe(true);
  });
});

describe("row keys", () => {
  it("are unique across the entire corpus", () => {
    const keys = all();
    expect(keys).toHaveLength(corpus.lineCount);
    expect(new Set(keys.map((l) => l.key)).size).toBe(keys.length);
  });

  it("survive what no field can distinguish", () => {
    // Why the key is positional. Both of these are true of the committed corpus, and either
    // one alone would collide a flat list: gossip lineIds are a hash of the text and are
    // shared by every NPC of that race and gender saying it, and 141 quest lines share an
    // NPC, a quest, a source and an mp3 with another line whose text differs.
    const lineIds = corpus.lines.map((l) => l.lineId);
    expect(new Set(lineIds).size).toBeLessThan(lineIds.length);

    const composite = corpus.lines.map((l) => `${npcKey(l)}/${l.questId}/${l.lineId}`);
    expect(new Set(composite).size).toBeLessThan(composite.length);
  });

  it("keep separate entity types apart", () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    const keys = npcKeys(all({ q: "68", filter: "npc" }));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("batch jobs", () => {
  it("drops lines the generator never voices", () => {
    const jobs = batchJobs(matchingLines(corpus, store, { q: "dughan" }));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job) => job.characters > 0)).toBe(true);
  });

  it("generates a shared file once", () => {
    const jobs = batchJobs(corpus.lines);
    expect(new Set(jobs.map((j) => j.audioPath)).size).toBe(jobs.length);
    expect(jobs.length).toBeLessThan(corpus.lines.filter((l) => l.generatable).length);
  });
});
