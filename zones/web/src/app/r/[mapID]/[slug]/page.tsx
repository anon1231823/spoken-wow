import { redirect } from "next/navigation";

import { BASE_LANG } from "@/lib/lang";

// The address the addon's Report button builds today, and the one already in players'
// hands: /r/{mapID}/{slug}, with no language in it. It meant English when it was
// written, so that is where it goes. A future addon build can link straight to
// /{lang}/r/... and skip the hop.
export default async function Page({
  params,
}: {
  params: Promise<{ mapID: string; slug: string }>;
}) {
  const { mapID, slug } = await params;
  redirect(`/${BASE_LANG}/r/${mapID}/${slug}`);
}
