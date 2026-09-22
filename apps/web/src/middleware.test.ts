import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

function run(path: string) {
  const response = middleware(new NextRequest(new URL(path, "https://spoken.test")));
  return {
    status: response.status,
    rewrite: response.headers.get("x-middleware-rewrite"),
    location: response.headers.get("location"),
  };
}

describe("the language proxy", () => {
  it("serves a bare path as English, without changing the address", () => {
    const seen = run("/quests?q=gnoll");
    expect(seen.rewrite).toBe("https://spoken.test/enUS/quests?q=gnoll");
    expect(seen.location).toBeNull();
  });

  it("serves the landing page as English", () => {
    expect(run("/").rewrite).toBe("https://spoken.test/enUS");
  });

  it("sends an explicit English prefix back to the one address English has", () => {
    const seen = run("/enUS/quests?q=gnoll");
    expect(seen.status).toBe(308);
    expect(seen.location).toBe("https://spoken.test/quests?q=gnoll");
    expect(run("/enUS").location).toBe("https://spoken.test/");
  });

  it("passes another language through as it is", () => {
    const seen = run("/ptBR/quests");
    expect(seen.rewrite).toBeNull();
    expect(seen.location).toBeNull();
  });

  it("does not take something shaped like a language for one", () => {
    expect(run("/xxYY/quests").rewrite).toBe("https://spoken.test/enUS/xxYY/quests");
  });

  it("stays away from the API, Next's assets, downloads and files", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/quests")).toBe(true);
    expect(matcher.test("/")).toBe(true);
    expect(matcher.test("/api/quests/search")).toBe(false);
    expect(matcher.test("/_next/static/chunk.js")).toBe(false);
    expect(matcher.test("/downloads/SpokenQuestsAudioComplete-latest.zip")).toBe(false);
    expect(matcher.test("/logo.png")).toBe(false);
    expect(matcher.test("/icons/quests.svg")).toBe(false);
  });
});
