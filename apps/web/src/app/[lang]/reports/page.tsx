import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import ReportTable from "@/components/ReportTable";
import { auth } from "@/lib/auth";
import { canRegenerate } from "@/lib/permissions";
import { isCategory, isStatus, type Category, type Status } from "@/lib/reports/reports";
import { listReports } from "@/lib/reports/store";
import { type Source, isSource } from "@/lib/sections";

export const metadata: Metadata = { title: "Reports · Spoken" };

// What strangers filed and what people did about it; nothing here can be cached between views.
export const dynamic = "force-dynamic";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ view?: string; source?: string; category?: string }>;
}) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /issues and /voices: a member has no business
  // learning the page exists, and these rows hold prose written by strangers.
  if (!session || !canRegenerate(session.user.role)) notFound();

  const { view, source: rawSource, category: rawCategory } = await searchParams;
  const status: Status | "all" = isStatus(view) ? view : view === "all" ? "all" : "open";
  // Both by default: a report is a person waiting for an answer, and which corpus it is
  // about does not change how long they have been waiting.
  const source: Source | "all" = isSource(rawSource) ? rawSource : "all";
  // Unknown reads as "all" rather than as a filter nothing matches, which would look like
  // an empty queue - the same bargain every explorer's filter parser makes.
  const category: Category | "all" = isCategory(rawCategory) ? rawCategory : "all";
  const reports = await listReports(status, source, category, undefined, lang);

  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Reports</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        What players filed from inside the game. A report is a claim, not a verdict: read it,
        listen to the line, and if it is right, queue the file for regeneration the usual way.
        Nothing here starts a job on its own.
      </p>

      <ReportTable
        initial={reports}
        view={status}
        source={source}
        category={category}
        canRegenerate
      />
    </main>
  );
}
