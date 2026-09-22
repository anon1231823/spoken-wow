import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import GrantTable from "@/components/GrantTable";
import { auth } from "@/lib/auth";
import { listGrants, viewerOf } from "@/lib/grants/store";

export const metadata: Metadata = { title: "Translators · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Who works on which language. For a global admin, every grant; for somebody who is admin
 * in a language, that language's, and the means to bring translators into it without
 * asking anybody. A 404 for everyone else, the way /admin answers a member.
 */
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  const viewer = await viewerOf(session);
  if (!viewer) notFound();

  const languages =
    viewer.role === "admin"
      ? null
      : viewer.grants.filter((grant) => grant.capability === "admin").map((grant) => grant.lang);
  if (languages !== null && languages.length === 0) notFound();

  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Translators</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Who may write, regenerate or look after each language. English is the collaborator
        role&apos;s, set on the Users page; everything here is one language at a time. A grant
        needs the person to have registered first.
      </p>
      <GrantTable initial={await listGrants(languages ?? undefined)} languages={languages} />
    </main>
  );
}
