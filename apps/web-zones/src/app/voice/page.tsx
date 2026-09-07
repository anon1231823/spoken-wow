import { redirect } from "next/navigation";

import { BASE_LANG, carriedQuery } from "@/lib/lang";

// See app/page.tsx: the bare path is the old address, and it meant English.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(`/${BASE_LANG}/voice${carriedQuery(await searchParams)}`);
}
