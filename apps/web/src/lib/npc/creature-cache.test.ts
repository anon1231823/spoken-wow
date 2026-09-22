import { describe, expect, it } from "vitest";

import { parseCreatureCache } from "./creature-cache";

/** A cache with one record per creature, each preceded by filler the parser has to skip. */
function cache(creatures: { npcId: number; filler: number[]; displays: [number, number, number][] }[]): ArrayBuffer {
  const bytes: number[] = [...Buffer.from("BOMW"), ...new Array(20).fill(0)];
  const u32 = (v: number) => [...new Uint8Array(new Uint32Array([v]).buffer)];
  const f32 = (v: number) => [...new Uint8Array(new Float32Array([v]).buffer)];
  for (const { npcId, filler, displays } of creatures) {
    const total = displays.reduce((sum, [, , p]) => sum + p, 0);
    const record = [
      ...filler,
      ...u32(displays.length), ...f32(total),
      ...displays.flatMap(([id, scale, p]) => [...u32(id), ...f32(scale), ...f32(p)]),
      ...new Array(24).fill(0),
    ];
    bytes.push(...u32(npcId), ...u32(record.length), ...record);
  }
  return new Uint8Array(bytes).buffer;
}

describe("parseCreatureCache", () => {
  it("finds each creature's appearances past its names", () => {
    const parsed = parseCreatureCache(
      cache([
        { npcId: 257554, filler: [3, 32, 0, 0, 16, ...Buffer.from("Halaan Hawk-Eye\0")], displays: [[143583, 1.2, 1]] },
        { npcId: 205729, filler: [1, 224, 0, 0, 19, ...Buffer.from("Boarton\0")], displays: [[112671, 1, 100]] },
      ]),
    );
    expect(parsed).toEqual([
      { npcId: 257554, displays: [{ displayId: 143583, probability: 1 }] },
      { npcId: 205729, displays: [{ displayId: 112671, probability: 100 }] },
    ]);
  });

  it("keeps every appearance of a creature that has several, and one with no stated odds", () => {
    const parsed = parseCreatureCache(
      cache([
        { npcId: 259377, filler: [0, 0, 0, 0, 19], displays: [[1587, 1, 1], [2858, 1, 1], [1589, 1, 1]] },
        { npcId: 3632, filler: [0, 0, 0, 0, 16], displays: [[1744, 1, 0]] },
      ]),
    );
    expect(parsed.map((c) => c.displays.map((d) => d.displayId))).toEqual([[1587, 2858, 1589], [1744]]);
  });

  it("refuses a file that is not a creature cache", () => {
    expect(() => parseCreatureCache(new Uint8Array([...Buffer.from("WQST"), 0, 0]).buffer)).toThrow(/creaturecache/);
  });
});
