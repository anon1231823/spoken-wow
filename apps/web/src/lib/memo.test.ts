import { describe, expect, it } from "vitest";

import { memoByLang } from "./memo";

describe("memoByLang", () => {
  it("builds once per version and language", () => {
    const key = Symbol("test");
    let builds = 0;
    const build = () => ++builds;
    expect(memoByLang(key, "enUS", "v1", build)).toBe(1);
    expect(memoByLang(key, "enUS", "v1", build)).toBe(1);
    expect(memoByLang(key, "ptBR", "v1", build)).toBe(2);
    expect(memoByLang(key, "enUS", "v2", build)).toBe(3);
  });

  it("does not keep a build that failed", async () => {
    const key = Symbol("test");
    const failing = memoByLang(key, "enUS", "v1", () => Promise.reject(new Error("timeout")));
    await expect(failing).rejects.toThrow("timeout");

    const retried = memoByLang(key, "enUS", "v1", () => Promise.resolve("built"));
    await expect(retried).resolves.toBe("built");
  });
});
