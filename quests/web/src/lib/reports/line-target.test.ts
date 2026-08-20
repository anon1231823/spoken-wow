import { describe, expect, it } from "vitest";

import { targetForLine } from "./line-target";
import { parseTarget } from "./target";

const quest = {
  lineId: "q:5:accept",
  source: "accept",
  questId: 5,
  npcId: 288,
} as Parameters<typeof targetForLine>[0];

const gossip = {
  lineId: "g:abc123",
  source: "gossip",
  questId: null,
  npcId: 68,
} as Parameters<typeof targetForLine>[0];

const progress = { ...quest, lineId: "q:7:progress", source: "progress", questId: 7 } as typeof quest;

describe("targetForLine", () => {
  it("addresses a quest line by quest and event", () => {
    expect(targetForLine(quest)).toBe("quest/5/accept");
    expect(targetForLine(progress)).toBe("quest/7/progress");
  });

  it("addresses a gossip line by its speaker, which has no quest to name", () => {
    expect(targetForLine(gossip)).toBe("npc/68");
  });

  it("produces addresses the report page can parse", () => {
    // The whole point of reusing the addon's address format: a report filed from the site and
    // one filed from the game land on the same target string, so triage sees one kind of row.
    for (const line of [quest, progress, gossip]) {
      const address = targetForLine(line);
      expect(address).not.toBeNull();
      expect(parseTarget(address!.split("/"))).not.toBeNull();
    }
  });

  it("refuses a quest line with no quest id", () => {
    // Nothing in the corpus should look like this, and an address of "quest/null/accept"
    // would resolve to nothing while looking like a real report.
    expect(targetForLine({ ...quest, questId: null })).toBeNull();
  });
});
