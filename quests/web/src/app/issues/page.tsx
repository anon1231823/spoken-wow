import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import IssueReview from "@/components/IssueReview";
import { auth } from "@/lib/auth";
import { readLexicon } from "@/lib/generation/dictionary";
import { issueList } from "@/lib/issues/store";
import { canConfigureGeneration } from "@/lib/permissions";

export const metadata: Metadata = { title: "Issues · VoiceOver Explorer" };

// Rows the scan wrote and verdicts people are recording against them; nothing here can be
// cached between views.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /lexicon and /voices: recording a verdict stops a
  // finding marking lines for everyone, and a member has no business learning the page exists.
  if (!session || !canConfigureGeneration(session.user.role)) notFound();

  const [issues, lexicon] = await Promise.all([issueList(), readLexicon()]);

  return (
    <main className="mx-auto max-w-6xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Issues</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        What a scan of the corpus says will trip the voice up: names no pronunciation rule
        covers, stage directions read aloud, Blizzard&rsquo;s own typos. Each row is one
        finding across however many lines say it. Fix a name by adding it to the lexicon, fix a
        line by rewriting what it says, and dismiss the rest so they stop asking.
      </p>

      <IssueReview initial={issues} lexiconSize={lexicon.entries.length} />
    </main>
  );
}
