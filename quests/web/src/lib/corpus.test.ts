import { describe, expect, it } from "vitest";

import { loadCorpus, npcKey } from "./corpus";

describe("corpus", () => {
  const corpus = loadCorpus();

  it("loads the committed corpus", () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.lines).toHaveLength(corpus.lineCount);
    expect(corpus.lineCount).toBeGreaterThan(17000);
  });

  it("carries the fields the explorer searches on", () => {
    const line = corpus.lines.find((l) => l.lineId === "q:5:accept");
    expect(line).toBeDefined();
    expect(line!.npcName).toBe("Jitters");
    expect(line!.questTitle).toBe("Jitters' Growling Gut");
    expect(line!.fileName).toBe("5-accept");
    expect(line!.voice).toBe("human-male");
  });

  it("namespaces npc keys by type", () => {
    // creature 68 is a Stormwind City Guard, gameobject 68 is a Wanted Poster
    expect(npcKey({ npcType: "creature", npcId: 68 })).not.toBe(
      npcKey({ npcType: "gameobject", npcId: 68 }),
    );
  });

  it("memoises, so repeated loads do not re-parse", () => {
    expect(loadCorpus()).toBe(corpus);
  });
});
