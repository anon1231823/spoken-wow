import { redirect } from "next/navigation";

import { BASE_LANG } from "@/lib/lang";

// See app/page.tsx: the bare path is the old address, and it meant English.
export default function Page() {
  redirect(`/${BASE_LANG}/voice`);
}
