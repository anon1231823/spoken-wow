import { describe, expect, it } from "vitest";

import { buildLineIndex, npcKey } from "./corpus";
import { corpus as catalogue, lineIndex } from "./quests/catalogue";

describe("corpus", async () => {
  const corpus = await catalogue();

  it("loads the committed corpus", async () => {
    expect(corpus.lines.length).toBeGreaterThan(17000);
  });

  it("carries the fields the explorer searches on", async () => {
    const line = corpus.lines.find((l) => l.lineId === "q:5:accept");
    expect(line).toBeDefined();
    expect(line!.npcName).toBe("Jitters");
    expect(line!.questTitle).toBe("Jitters' Growling Gut");
    expect(line!.fileName).toBe("5-accept");
    expect(line!.voice).toBe("human-male-standard");
  });

  it("namespaces npc keys by type", async () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    expect(npcKey({ npcType: "creature", npcId: 68 })).not.toBe(
      npcKey({ npcType: "gameobject", npcId: 68 }),
    );
  });

  it("memoises, so repeated loads do not re-parse", async () => {
    expect((await catalogue()).lines).toBe(corpus.lines);
  });
});

// One lineId can belong to many lines. A gossip lineId is g:{md5(text + race + gender)}, so
// every dwarf man with the same greeting shares one id and one mp3 - which is what makes
// regeneration an operation on a file rather than on an NPC's line.
describe("lineIndex", async () => {
  const index = await lineIndex();

  it("indexes every line in the corpus", async () => {
    const total = [...index.values()].reduce((sum, group) => sum + group.length, 0);
    expect(total).toBe((await catalogue()).lines.length);
  });

  it("finds a quest line under its id", async () => {
    expect(index.get("q:5:accept")!.map((l) => l.npcName)).toContain("Jitters");
  });

  it("groups the NPCs that share a gossip line", async () => {
    const shared = [...index.values()].filter(
      (group) => group.length > 1 && group[0].source === "gossip",
    );
    expect(shared.length).toBeGreaterThan(0);

    // Text, voice and filename are properties of the line; only the speaker varies.
    for (const group of shared.slice(0, 50)) {
      expect(new Set(group.map((l) => l.text)).size).toBe(1);
      expect(new Set(group.map((l) => l.voice)).size).toBe(1);
      expect(new Set(group.map((l) => l.fileName)).size).toBe(1);
    }
  });

  it("memoises", async () => {
    expect(await lineIndex()).toBe(index);
    expect(buildLineIndex(await catalogue())).not.toBe(index);
  });
});
