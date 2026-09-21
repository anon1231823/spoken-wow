import { describe, expect, it } from "vitest";

import { spokenFromTemplate } from "./tokens";

describe("spokenFromTemplate", () => {
  it("speaks the reader's tokens the way the extract does", () => {
    expect(spokenFromTemplate("$N! A $R $c, $N's kind.")).toBe("Adventurer! A Traveler adventurer, Adventurer's kind.");
  });

  it("leaves a token it does not know for the text gate to refuse", () => {
    expect(spokenFromTemplate("$2113w crates")).toBe("$2113w crates");
  });
});
