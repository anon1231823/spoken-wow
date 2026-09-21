import { describe, expect, it } from "vitest";

import { CHAT_LINE_LIMIT, gameScript } from "./game-script";

describe("gameScript", () => {
  it("fits every line in a chat box", () => {
    const ids = Array.from({ length: 500 }, (_, i) => 200000 + i);
    for (const line of gameScript(ids)) expect(line.length).toBeLessThanOrEqual(CHAT_LINE_LIMIT);
  });

  it("carries every id once, in order, before the command that walks them", () => {
    const ids = Array.from({ length: 120 }, (_, i) => 250000 + i);
    const lines = gameScript(ids);
    expect(lines[0].startsWith("/run SPK={")).toBe(true);
    expect(lines.at(-1)).toContain("SetCreature");
    const carried = lines.slice(0, -1).flatMap((line) => line.match(/\{([\d,]*)\}/)![1].split(",").map(Number));
    expect(carried).toEqual(ids);
  });

  it("still starts a list when nothing is pending", () => {
    expect(gameScript([])).toHaveLength(2);
  });
});
