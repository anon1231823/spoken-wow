import { Suspense } from "react";

import { Explorer } from "@/components/Explorer";
import { zoneFacets } from "@/lib/catalogue";
import { BASE_LANG, isLang } from "@/lib/lang";

// The zone list is derived from the catalogue, so computing it here and passing it
// down beats a round trip that would buy nothing but an empty dropdown on first paint.
// Per language: a translated zone line renames the zone in the dropdown too.

// RENDERED PER REQUEST, not at build. The catalogue is `lore_line`, which changes every
// time somebody edits a line -- prerendering this would pin the zone dropdown to
// whatever the corpus said when the image was built, and would need a database at build
// time to say even that. The layout's generateStaticParams still enumerates the language
// segments; this opts their content out of the prerender.
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang: rawLang } = await params;
  // The layout already 404s an unknown code; the guard here is what types the value.
  const lang = isLang(rawLang) ? rawLang : BASE_LANG;
  const zones = await zoneFacets(lang);

  return (
    // Suspense is required: Explorer calls useSearchParams().
    <Suspense>
      <Explorer zones={zones} />
    </Suspense>
  );
}
