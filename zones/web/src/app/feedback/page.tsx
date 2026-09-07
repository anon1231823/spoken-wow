import { redirect } from "next/navigation";

import { BASE_LANG, carriedQuery } from "@/lib/lang";

// See app/page.tsx: the bare path is the old address, and it meant English. The
// query rides along -- "?status=resolved" is which view is being asked for.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/${BASE_LANG}/feedback${carriedQuery(await searchParams)}`);
}
