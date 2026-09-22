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
