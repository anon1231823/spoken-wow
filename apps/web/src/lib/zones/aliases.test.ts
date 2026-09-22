import { describe, expect, it } from "vitest";

import { namesFromAliases, parseAliases } from "@tools/lib/aliases.mjs";

const LUA = `
local aliases = {
	["Abtei von Nordhain"] = "northshire abbey",
	["Durotar"] = "durotar",
	["Klingenhügel \\"alt\\""] = "razor hill",
	["Klingenhügel"] = "razor hill",
}
`;

describe("the alias tables, read as names", () => {
  it("reads every entry, quotes and all", () => {
    expect(parseAliases(LUA)).toEqual([
      ["Abtei von Nordhain", "northshire abbey"],
      ["Durotar", "durotar"],
      ['Klingenhügel "alt"', "razor hill"],
      ["Klingenhügel", "razor hill"],
    ]);
  });

  it("names a subzone by its key and a zone by its name, first entry winning", () => {
    const lines = [
      { lineId: "z:1411", kind: "zone", key: null, name: "Durotar" },
      { lineId: "s:1411:razor hill", kind: "subzone", key: "razor hill", name: "Razor Hill" },
      { lineId: "s:1429:goldshire", kind: "subzone", key: "goldshire", name: "Goldshire" },
    ];
    expect(namesFromAliases(lines, parseAliases(LUA))).toEqual([
      { kind: "zone", entityId: "z:1411", name: "Durotar" },
      { kind: "subzone", entityId: "s:1411:razor hill", name: 'Klingenhügel "alt"' },
    ]);
  });
});
