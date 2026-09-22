import { describe, expect, it } from "vitest";

import { LOCALES as PIPELINE_LOCALES } from "@tools/lib/locales.mjs";

import { BASE_LANG, CODES, isLang, LOCALES, langTag } from "./lang";

describe("the site's language list", () => {
  // The site restates the list as a literal to get a type out of it. A code added to the
  // pipeline and not here would be a language packs could be built in and the site could not
  // show; one added here and not there, a URL prefix with nothing behind it.
  it("is the pipeline's list, in the pipeline's order", () => {
    expect(LOCALES.map(({ code, name, bcp47 }) => ({ code, name, bcp47 }))).toEqual(
      PIPELINE_LOCALES.map(({ code, name, bcp47 }) => ({ code, name, bcp47 })),
    );
  });

  it("starts from English", () => {
    expect(BASE_LANG).toBe("enUS");
    expect(CODES[0]).toBe(BASE_LANG);
  });

  it("accepts a code only in its exact spelling", () => {
    expect(isLang("ptBR")).toBe(true);
    // A region-less or lower-cased code is a different language as far as a pack folder is
    // concerned (esES and esMX are two), so nothing normalises it into one.
    expect(isLang("pt")).toBe(false);
    expect(isLang("ptbr")).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });

  it("names the page's language for <html lang>", () => {
    expect(langTag("ptBR")).toBe("pt-BR");
  });
});

describe("addresses", () => {
  it("leaves English where it always was", async () => {
    const { localeHref } = await import("./lang");
    expect(localeHref("enUS", "/quests?q=1")).toBe("/quests?q=1");
    expect(localeHref("enUS", "/")).toBe("/");
  });

  it("prefixes another language's pages, and nothing else", async () => {
    const { localeHref } = await import("./lang");
    expect(localeHref("ptBR", "/quests?q=1")).toBe("/ptBR/quests?q=1");
    expect(localeHref("ptBR", "/")).toBe("/ptBR");
    expect(localeHref("ptBR", "/api/quests/search")).toBe("/api/quests/search");
    expect(localeHref("ptBR", "https://www.wowhead.com/classic")).toBe("https://www.wowhead.com/classic");
    expect(localeHref("ptBR", "//cdn.example")).toBe("//cdn.example");
  });

  it("takes a prefix off again, and only a real language's", async () => {
    const { stripLang } = await import("./lang");
    expect(stripLang("/ptBR/quests?q=1")).toEqual({ lang: "ptBR", path: "/quests?q=1" });
    expect(stripLang("/ptBR")).toEqual({ lang: "ptBR", path: "/" });
    expect(stripLang("/ptBR?x=1")).toEqual({ lang: "ptBR", path: "/?x=1" });
    expect(stripLang("/quests")).toEqual({ lang: "enUS", path: "/quests" });
    expect(stripLang("/xxYY/quests")).toEqual({ lang: "enUS", path: "/xxYY/quests" });
  });

  it("asks an API for a language only when it is not English", async () => {
    const { withLang } = await import("./lang");
    expect(withLang("enUS", "/api/quests/search?q=1")).toBe("/api/quests/search?q=1");
    expect(withLang("ptBR", "/api/quests/search?q=1")).toBe("/api/quests/search?q=1&lang=ptBR");
    expect(withLang("ptBR", "/api/quests/audio/quests/1-accept.mp3")).toBe(
      "/api/quests/audio/quests/1-accept.mp3?lang=ptBR",
    );
  });
});
