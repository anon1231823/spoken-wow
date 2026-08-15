import { redirect } from "next/navigation";

import { BASE_LANG } from "@/lib/lang";

// The address addon builds up to 0.3.1 put in players' hands: /r/{mapID}/{slug}, with
// no language in it. It meant English when it was written, so that is where it goes.
// Newer builds link straight to /{lang}/r/... and skip the hop.
export default async function Page({
  params,
}: {
  params: Promise<{ mapID: string; slug: string }>;
}) {
  const { mapID, slug } = await params;
  redirect(`/${BASE_LANG}/r/${mapID}/${slug}`);
}
