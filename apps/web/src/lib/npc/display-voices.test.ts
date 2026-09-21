import { describe, expect, it } from "vitest";

import { voiceForDisplay } from "./display-voices";

// Appearance ids from the 1.60.1 client, as its creature cache reported them for real NPCs.
describe("voiceForDisplay", () => {
  it("takes a named voice set on the roster as exact", async () => {
    // Boarton Shadetotem: a tauren speaking in taurenmalewarriornpc's voice.
    expect(await voiceForDisplay(112671)).toMatchObject({
      voice: { race: "tauren", gender: "male", flavor: "warrior" },
      exact: true,
    });
  });

  it("matches a set the roster names by id", async () => {
    // Halaan Hawk-Eye.
    expect(await voiceForDisplay(143583)).toMatchObject({
      voice: { race: "skybourneelf", gender: "male", flavor: "3776" },
      exact: true,
    });
  });

  it("lets the voice set decide over the model", async () => {
    // Elatrell Featherlight is drawn as a blood elf and greets you in the Skybourne male voice.
    expect(await voiceForDisplay(136967)).toMatchObject({
      voice: { race: "skybourneelf", gender: "male", flavor: "3776" },
    });
  });

  it("answers nothing, with a reason, for an appearance it has no record of", async () => {
    expect(await voiceForDisplay(999_999_999)).toMatchObject({ voice: null, reason: expect.stringMatching(/no model/) });
  });
});
