import { redirect } from "next/navigation";

import { BASE_LANG } from "@/lib/lang";

// See app/page.tsx: the bare path is the old address, and it meant English. The page
// is called pronunciation now, which is what it was always about.
export default function Page() {
  redirect(`/${BASE_LANG}/pronunciation`);
}
