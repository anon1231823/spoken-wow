/**
 * The triage table's view of a line, which has to be one shape across three corpora.
 *
 * Pure and tested here rather than read out inside the expanded row, because the three
 * ResultLine types agree on nothing: quests has `lineId` and `audioPath`, zones and books
 * have `id` and `file`, and a row that read the wrong pair would render an empty panel
 * with no error to see.
 */
import { describe, expect, it } from "vitest";

import { detailOf, regeneratePath, searchPath } from "./detail";
import type { ResultLine as BookLine } from "@/lib/books/search";
import type { ResultLine as QuestLine } from "@/lib/search";
import type { ResultLine as ZoneLine } from "@/lib/zones/search";

const questLine = {
  lineId: "q:374:accept",
  npcName: "Marshal Dughan",
  questTitle: "Kobold Camp Cleanup",
  race: "human",
  gender: "male",
  flavor: null,
  voice: "human-male",
  text: "Those kobolds are a menace.",
  audioPath: "quests/374-accept.mp3",
  hasAudio: true,
} as unknown as QuestLine;

const zoneLine = {
  id: "s:1411:razor hill",
  name: "Razor Hill",
  zoneName: "Durotar",
  text: "A hard-packed road runs north.",
  file: "1411/razor-hill",
  state: "current",
} as unknown as ZoneLine;

const bookLine = {
  id: "b:261",
  title: "The Dusty Tome",
  pageNumber: 2,
  pageCount: 4,
  text: "It begins with a warning.",
  file: "261/2",
  state: "missing",
} as unknown as BookLine;

describe("detailOf", () => {
  it("names a quest line by its NPC, and says which voice it was cut with", () => {
    const detail = detailOf("quests", questLine);
    expect(detail.heading).toBe("Kobold Camp Cleanup");
    expect(detail.context).toBe("Marshal Dughan · human male · human-male");
    expect(detail.text).toBe("Those kobolds are a menace.");
    expect(detail.lineId).toBe("q:374:accept");
    expect(detail.audioSrc).toBe("/api/quests/audio/quests/374-accept.mp3");
  });

  it("carries a quest line's flavor, which is what picks one of that race's voices", () => {
    const shaman = { ...questLine, flavor: "shaman" } as QuestLine;
    expect(detailOf("quests", shaman).context).toBe(
      "Marshal Dughan · human male shaman · human-male",
    );
  });

  it("places a zone line by zone and subzone", () => {
    const detail = detailOf("zones", zoneLine);
    expect(detail.heading).toBe("Razor Hill");
    expect(detail.context).toBe("Durotar");
    expect(detail.lineId).toBe("s:1411:razor hill");
    expect(detail.audioSrc).toBe("/api/zones/audio/1411/razor-hill.mp3");
  });

  it("places a book page in its book", () => {
    const detail = detailOf("books", bookLine);
    expect(detail.heading).toBe("The Dusty Tome");
    expect(detail.context).toBe("page 2 of 4");
    expect(detail.lineId).toBe("b:261");
  });

  it("offers no audio for a line that has none, rather than a src that 404s", () => {
    expect(detailOf("books", bookLine).audioSrc).toBeNull();
    expect(detailOf("quests", { ...questLine, hasAudio: false } as QuestLine).audioSrc).toBeNull();
  });

  it("reads a rewritten quest line as what it now says, not what the corpus says", () => {
    const rewritten = { ...questLine, override: "Those kobolds are a nuisance." } as QuestLine;
    expect(detailOf("quests", rewritten).text).toBe("Those kobolds are a nuisance.");
  });

  it("busts the cache with the take a regeneration just wrote", () => {
    expect(detailOf("zones", zoneLine, 7).audioSrc).toBe("/api/zones/audio/1411/razor-hill.mp3?v=7");
  });
});

describe("searchPath and regeneratePath", () => {
  it("asks each section's own search for exactly the reported line", () => {
    expect(searchPath("quests", "q:374:accept")).toBe(
      "/api/quests/search?line=q%3A374%3Aaccept&limit=1",
    );
    expect(searchPath("zones", "z:1411")).toBe("/api/zones/search?line=z%3A1411&limit=1");
  });

  it("posts a regeneration to the section that owns the line", () => {
    expect(regeneratePath("books")).toBe("/api/books/regenerate");
    expect(regeneratePath("quests")).toBe("/api/quests/regenerate");
  });
});
