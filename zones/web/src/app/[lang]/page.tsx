import { Suspense } from "react";

import { Explorer } from "@/components/Explorer";
import { zoneFacets } from "@/lib/catalogue";

// The zone list is derived from committed lore data that cannot change while the
// server runs, so computing it here and passing it down beats a round trip that would
// buy nothing but an empty dropdown on first paint.
export default async function Page() {
  const zones = await zoneFacets();

  return (
    // Suspense is required: Explorer calls useSearchParams().
    <Suspense>
      <Explorer zones={zones} />
    </Suspense>
  );
}
