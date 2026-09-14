import type { Metadata } from "next";
import { Suspense } from "react";

import { Explorer } from "@/components/zones/Explorer";
import { isCorpusEmpty, zoneFacets } from "@/lib/zones/catalogue";
import { BASE_LANG } from "@/lib/zones/lang";

export const metadata: Metadata = { title: "Zones · Spoken" };

/**
 * The zone dropdown is derived from the catalogue, so computing it here and passing it
 * down beats a round trip that would buy nothing but an empty dropdown on first paint.
 *
 * RENDERED PER REQUEST, not at build. The catalogue is `lore_line`, which changes every
 * time somebody edits a line -- prerendering this would pin the dropdown to whatever the
 * corpus said when the image was built, and would need a database at build time to say
 * even that.
 */
export const dynamic = "force-dynamic";

export default async function Page() {
  let zones;
  try {
    zones = await zoneFacets(BASE_LANG);
  } catch (error) {
    // Said on the page rather than thrown at it. Between a fresh deployment and its
    // cutover this section has no rows yet, and a stack trace is the wrong way to tell
    // somebody that the import has not been run.
    if (!isCorpusEmpty(error)) throw error;
    return (
      <main className="shell pt-10 pb-24">
        <h1 className="text-xl font-semibold">Zone lore</h1>
        <p className="text-muted-foreground mt-2 max-w-xl text-sm">
          The lore corpus has not been loaded into this database yet, so there is nothing to
          show. It is seeded from the committed Lua with{" "}
          <code className="text-foreground">make zones-lore-import</code>.
        </p>
      </main>
    );
  }

  return (
    <main className="pt-6 pb-36">
      <div className="shell">
        <h1 className="text-xl font-semibold">Zone lore</h1>
        <p className="text-muted-foreground mt-1 mb-5 text-sm">
          The prose the addon reads when you walk into a place, for every zone and subzone.
          Unlike quest dialogue, these words are written rather than extracted: scraped from
          warcraft.wiki.gg, sometimes rewritten, and correctable here.
        </p>
      </div>
      {/* Suspense is required: Explorer calls useSearchParams(). */}
      <Suspense>
        <Explorer zones={zones} />
      </Suspense>
    </main>
  );
}
