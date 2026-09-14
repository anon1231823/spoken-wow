import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

// paths.ts reads the env at import time, so the temp directory has to be in place before the
// module graph is loaded. Same reason as samples.test.ts.
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "voiceover-npc-lines-"));
  process.env.SPOKEN_QUESTS_NPC_LINES = dir;
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.SPOKEN_QUESTS_NPC_LINES;
});

async function seed(voice: string, ...names: string[]) {
  const parts = voice.split("-");
  const target = path.join(dir, `${parts[0]}-${parts[1]}`, parts[2]);
  await fs.mkdir(target, { recursive: true });
  for (const name of names) await fs.writeFile(path.join(target, name), "audio");
  return target;
}

describe("npcLineClips", () => {
  it("reads the flavor's directory, named by splitting the slot", async () => {
    const target = await seed(
      "orc-female-shaman",
      "OrcFemaleShamanNPCGreeting01.ogg",
      "OrcFemaleShamanNPCFarewell01.ogg",
    );
    const { npcLineClips } = await import("./npcLines");

    expect(await npcLineClips("orc-female-shaman")).toEqual([
      path.join(target, "OrcFemaleShamanNPCFarewell01.ogg"),
      path.join(target, "OrcFemaleShamanNPCGreeting01.ogg"),
    ]);
  });

  it("is empty for a slot with no clips on disk", async () => {
    const { npcLineClips } = await import("./npcLines");
    expect(await npcLineClips("orc-female-shaman")).toEqual([]);
  });

  // narrator-male is a pseudo-race for gameobjects; the game has no voice sets for it.
  it("is empty for a slot with no flavor", async () => {
    const { npcLineClips } = await import("./npcLines");
    expect(await npcLineClips("narrator-male")).toEqual([]);
  });

  it("skips dotfiles, so a partial write is never cloned", async () => {
    const target = await seed("orc-female-shaman", "a.ogg", ".b.ogg.part");
    const { npcLineClips } = await import("./npcLines");
    expect(await npcLineClips("orc-female-shaman")).toEqual([path.join(target, "a.ogg")]);
  });

  // The same whitelist that guards the sample directories: a slot name becomes a path
  // segment, so a traversal has to fail on the same code path as a typo.
  it("refuses anything that is not a voice slot", async () => {
    const { npcLineClips } = await import("./npcLines");
    await expect(npcLineClips("../../etc")).rejects.toThrow(/unknown voice slot/);
    await expect(npcLineClips("orc-female-drunk")).rejects.toThrow(/unknown voice slot/);
  });
});
