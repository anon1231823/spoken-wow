import { describe, expect, it } from "vitest";

import { loadCorpus } from "@/lib/corpus";
import { canonicalNpcId, ELEVENLABS_SEED_MAX, seedFor } from "./seed";

/**
 * Produced by the Python side, and the whole point of this file:
 *
 *   python3 -c 'import zlib; print([zlib.crc32(str(i).encode()) for i in [0,1,68,240,99999]])'
 *
 * If node:zlib and Python's zlib ever disagree, an NPC gets one voice from the CLI and a
 * different one from the web app - the defect the seed was introduced to fix, reintroduced
 * by the port. These values are the tripwire.
 */
const PYTHON_CRC32: Record<number, number> = {
  0: 4108050209,
  1: 2212294583,
  68: 3771153172,
  240: 1163733943,
  99999: 2634760556,
};

describe("seedFor", () => {
  it("matches zlib.crc32 in Python", () => {
    for (const [npcId, expected] of Object.entries(PYTHON_CRC32)) {
      expect(seedFor(Number(npcId), "npc")).toBe(expected);
    }
  });

  it("returns nothing for the 'none' strategy", () => {
    expect(seedFor(240, "none")).toBeNull();
  });

  it("stays inside the range ElevenLabs accepts", () => {
    for (const npcId of [0, 1, 68, 240, 99999, 2147483647]) {
      const seed = seedFor(npcId, "npc")!;
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(ELEVENLABS_SEED_MAX);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });

  it("is stable across calls, which is the only property that matters", () => {
    expect(seedFor(240, "npc")).toBe(seedFor(240, "npc"));
    expect(seedFor(240, "npc")).not.toBe(seedFor(241, "npc"));
  });
});

describe("canonicalNpcId", () => {
  it("takes the lowest id, so selection order cannot change the seed", () => {
    expect(canonicalNpcId([{ npcId: 900 }, { npcId: 12 }, { npcId: 400 }])).toBe(12);
    expect(canonicalNpcId([{ npcId: 12 }, { npcId: 900 }, { npcId: 400 }])).toBe(12);
  });

  it("is the id itself for a line only one NPC speaks", () => {
    expect(canonicalNpcId([{ npcId: 240 }])).toBe(240);
  });
});

// The reason canonicalNpcId exists at all: a gossip lineId is a hash of text, race and
// gender, so it says nothing about who speaks it. If this ever stops finding a shared line,
// the corpus has changed shape and the seeding rule should be revisited.
describe("the corpus this is written against", () => {
  it("still has lineIds spoken by more than one NPC", () => {
    const byLine = new Map<string, Set<number>>();
    for (const line of loadCorpus().lines) {
      if (!line.generatable) continue;
      if (!byLine.has(line.lineId)) byLine.set(line.lineId, new Set());
      byLine.get(line.lineId)!.add(line.npcId);
    }
    const shared = [...byLine.values()].filter((npcs) => npcs.size > 1);
    expect(shared.length).toBeGreaterThan(0);
  });
});
