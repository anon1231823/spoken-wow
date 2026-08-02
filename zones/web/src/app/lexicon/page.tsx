import { notFound } from "next/navigation";

import { LexiconEditor } from "@/components/LexiconEditor";
import { currentSession } from "@/lib/authz";
import { canConfigure } from "@/lib/permissions";

// Admin only, and 404 rather than a redirect, matching /admin. The editor would render an
// empty table for anyone else anyway -- /api/lexicon refuses them -- and an empty table is
// a worse answer than no page.
export default async function Page() {
  const session = await currentSession();
  if (!session || !canConfigure(session.user.role)) notFound();

  return <LexiconEditor />;
}
