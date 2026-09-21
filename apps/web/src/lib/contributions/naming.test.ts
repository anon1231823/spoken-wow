import { describe, expect, it } from "vitest";

import { corpus } from "@/lib/quests/catalogue";

import { answersQuestMoment, gossipFileName, gossipHash, gossipLineId, questFileName, questLineId, voiceNameFor } from "./naming";

describe("questLineId / questFileName", () => {
  it("matches a real corpus id and file -- q:33:accept -> 33-accept", async () => {
    const line = (await corpus()).lines.find((l) => l.lineId === "q:33:accept");
    expect(line).toBeDefined();
    expect(questLineId(33, "accept")).toBe(line!.lineId);
    expect(questFileName(33, "accept")).toBe(line!.fileName);
  });

  it("carries the event through unchanged", () => {
    expect(questLineId(76156, "progress")).toBe("q:76156:progress");
    expect(questFileName(76156, "progress")).toBe("76156-progress");
  });
});

describe("gossipHash / gossipLineId / gossipFileName", () => {
  it("matches a real corpus gossip line: md5(originalText + race + gender)", async () => {
    const line = (await corpus()).lines.find((l) => l.source === "gossip" && l.playerGender === null);
    expect(line).toBeDefined();
    const hash = gossipHash(line!.originalText, line!.race, line!.gender);
    expect(gossipLineId(hash)).toBe(line!.lineId);
    expect(gossipFileName(hash)).toBe(line!.fileName);
  });

  it("changes with the race or the gender, not just the text", () => {
    const a = gossipHash("Halt!", "human", "male");
    const b = gossipHash("Halt!", "human", "female");
    const c = gossipHash("Halt!", "orc", "male");
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("voiceNameFor", () => {
  it("joins race-gender-flavor when there is a flavor", () => {
    expect(voiceNameFor("tauren", "male", "warrior")).toBe("tauren-male-warrior");
  });

  it("drops the flavor segment when there is none", () => {
    expect(voiceNameFor("bloodelf", "female", null)).toBe("bloodelf-female");
  });
});

describe("answersQuestMoment", () => {
  it("matches the bare id and its player-gender variants, and nothing else", () => {
    expect(answersQuestMoment("q:166:complete", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:166:complete:m", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:166:complete:f", "q:166:complete")).toBe(true);
    expect(answersQuestMoment("q:1666:complete", "q:166:complete")).toBe(false);
    expect(answersQuestMoment("q:166:accept", "q:166:complete")).toBe(false);
  });
});
