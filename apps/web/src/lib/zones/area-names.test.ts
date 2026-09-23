import { describe, expect, it } from "vitest";

import { areaNames, namesForLines } from "@tools/lib/area-names.mjs";

describe("a language's area names, from AreaTable", () => {
  const english = [
    { ID: "14", AreaName_lang: "Durotar" },
    { ID: "362", AreaName_lang: "Razor Hill" },
    { ID: "1637", AreaName_lang: "Orgrimmar" },
    { ID: "44", AreaName_lang: "Redridge Mountains" },
    { ID: "5000", AreaName_lang: "Razor Hill" },
    { ID: "9", AreaName_lang: "Northshire Valley" },
  ];
  const spanish = [
    { ID: "14", AreaName_lang: "Durotar" },
    { ID: "362", AreaName_lang: "Cerrotajo" },
    { ID: "1637", AreaName_lang: "Orgrimmar" },
    { ID: "44", AreaName_lang: "Montañas Crestagrana" },
    { ID: "5000", AreaName_lang: "Cerrotajo (viejo)" },
    { ID: "9", AreaName_lang: "Valle de Villanorte" },
  ];
  const wanted = new Set(["durotar", "razor hill", "orgrimmar", "redridge mountains"]);

  it("keeps zones, and names that are the same in both languages", () => {
    expect(Object.fromEntries(areaNames(english, spanish, wanted))).toEqual({
      durotar: "Durotar",
      "razor hill": "Cerrotajo",
      orgrimmar: "Orgrimmar",
      "redridge mountains": "Montañas Crestagrana",
    });
  });

  it("names a subzone by its key and a zone by its name", () => {
    const lines = [
      { lineId: "z:1411", kind: "zone", key: null, name: "Durotar" },
      { lineId: "s:1411:razor hill", kind: "subzone", key: "razor hill", name: "Razor Hill" },
      { lineId: "s:1429:goldshire", kind: "subzone", key: "goldshire", name: "Goldshire" },
    ];
    const names = { durotar: "Durotar", "razor hill": "Cerrotajo" };
    expect(namesForLines(lines, names)).toEqual([
      { kind: "zone", entityId: "z:1411", name: "Durotar" },
      { kind: "subzone", entityId: "s:1411:razor hill", name: "Cerrotajo" },
    ]);
  });
});
