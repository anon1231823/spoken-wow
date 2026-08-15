import { Suspense } from "react";

import { Explorer } from "@/components/Explorer";
import { zoneFacets } from "@/lib/catalogue";
import { BASE_LANG, isLang } from "@/lib/lang";

// The zone list is derived from the catalogue, so computing it here and passing it
// down beats a round trip that would buy nothing but an empty dropdown on first paint.
// Per language: a translated zone line renames the zone in the dropdown too.
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
