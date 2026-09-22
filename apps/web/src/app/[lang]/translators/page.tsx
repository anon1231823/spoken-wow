import type { Metadata } from "next";
import { notFound } from "next/navigation";

import GrantTable from "@/components/GrantTable";
import { listGrants, viewerOf } from "@/lib/grants/store";
import { pageLang } from "@/lib/lang-server";
import { can } from "@/lib/permissions";
import { currentSession } from "@/lib/session";

export const metadata: Metadata = { title: "Translators · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Who works on which language. For a global admin, every grant; for somebody who is admin
 * in the page's language, that language's, and the means to bring translators into it
 * without asking anybody. A 404 for everyone else, the way /admin answers a member -- which
 * includes a language admin on another language's pages, where they are a member.
 */
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const viewer = await viewerOf(await currentSession());
  if (!viewer || !can(viewer, "admin", lang)) notFound();

  const languages = viewer.role === "admin" ? null : [lang];

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
