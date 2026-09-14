/**
 * The addresses one page uses to reach another.
 *
 * Worth a test of its own because the failure mode is silent: the quests explorer used to
 * be the site root, so /issues and /lexicon pointed at `/?q=…`, and after the merge that
 * address is the landing page. It renders, it returns 200, and it shows none of what the
 * link meant. Nothing in a build, a typecheck or a route test can see that; only an
 * assertion about the string can.
 */
import { describe, expect, it } from "vitest";

import { lexiconHref, questsHref, zonesHref } from "./links";

describe("questsHref", () => {
  it("addresses the section, never the site root", () => {
    expect(questsHref({})).toBe("/quests");
    expect(questsHref({ q: "thrall" }).startsWith("/quests?")).toBe(true);
  });

  it("carries a finding as the filter, with the word for the search box", () => {
    const href = questsHref({ finding: 42, q: "--", filter: "text" });
    const params = new URLSearchParams(href.slice(href.indexOf("?")));
    expect(params.get("finding")).toBe("42");
    expect(params.get("q")).toBe("--");
    expect(params.get("filter")).toBe("text");
  });

  it("escapes a word the URL would otherwise read as syntax", () => {
    // Findings are corpus text: '&', '#' and '+' all appear in it, and an unescaped one
    // either truncates the query or arrives as a different word.
    const href = questsHref({ q: "R&D #2 + more", filter: "text" });
    expect(new URLSearchParams(href.slice(href.indexOf("?"))).get("q")).toBe("R&D #2 + more");
  });

  it("omits what was not asked for", () => {
    expect(questsHref({ finding: 7 })).toBe("/quests?finding=7");
  });
});

describe("zonesHref", () => {
  it("names the zone filter the explorer actually reads", () => {
    // filtersFromParams reads `zone`, not `mapID`.
    expect(zonesHref({ mapID: 1411 })).toBe("/zones?zone=1411");
    expect(zonesHref()).toBe("/zones");
  });
});

describe("lexiconHref", () => {
  it("fills the grapheme in", () => {
    expect(lexiconHref("Anduin")).toBe("/lexicon?grapheme=Anduin");
  });
});
