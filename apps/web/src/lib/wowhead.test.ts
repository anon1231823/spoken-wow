import { describe, expect, it } from "vitest";

import { wowheadEntityUrl, wowheadForeverUrl, wowheadQuestUrl } from "./wowhead";

describe("wowhead links", () => {
  it("points at the Classic database, not retail", () => {
    // The retail page for a vanilla quest may describe a quest that was changed or removed.
    expect(wowheadQuestUrl(8516)).toBe("https://www.wowhead.com/classic/quest=8516");
  });

  it("spells each id space the way Wowhead does", () => {
    expect(wowheadEntityUrl("creature", 240)).toBe("https://www.wowhead.com/classic/npc=240");
    expect(wowheadEntityUrl("gameobject", 68)).toBe("https://www.wowhead.com/classic/object=68");
    expect(wowheadEntityUrl("item", 1307)).toBe("https://www.wowhead.com/classic/item=1307");
  });

  it("keeps the two id spaces apart", () => {
    // Creature 68 is a Stormwind City Guard; gameobject 68 is a Wanted Poster.
    expect(wowheadEntityUrl("creature", 68)).not.toBe(wowheadEntityUrl("gameobject", 68));
  });
});

describe("wowheadForeverUrl", () => {
  it("points at the Anniversary branch, not Classic Era", () => {
    // The branch the contribution's own client is on -- see the docstring atop wowhead.ts for
    // why a post-vanilla NPC (this branch's own case, 205729) needs it at all.
    expect(wowheadForeverUrl("creature", 205729)).toBe("https://www.wowhead.com/forever/npc=205729");
  });

  it("spells each id space the same way the Classic builder does", () => {
    expect(wowheadForeverUrl("gameobject", 68)).toBe("https://www.wowhead.com/forever/object=68");
  });
});
