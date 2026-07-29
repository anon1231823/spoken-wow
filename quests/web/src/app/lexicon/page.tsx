import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import LexiconEditor from "@/components/LexiconEditor";
import { auth } from "@/lib/auth";
import { readLexicon } from "@/lib/generation/dictionary";
import { currentConfig } from "@/lib/generation/settings";
import { canConfigureGeneration } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pronunciation · VoiceOver Explorer" };

// The lexicon is a database row and the sync state changes underneath it, so nothing here
// can be cached between views.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /voices and /admin: a member has no business
  // learning that this page exists.
  if (!session || !canConfigureGeneration(session.user.role)) notFound();

  const [lexicon, config] = await Promise.all([readLexicon(), currentConfig()]);

  return (
    <main className="mx-auto max-w-5xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Pronunciation</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        How ElevenLabs should say the names the corpus uses. Each entry becomes a phoneme rule
        in a pronunciation dictionary, matched case-insensitively at word boundaries, and every
        line generated afterwards is spoken with it. Only names a plain reader gets wrong belong
        here — a rule for a name it already handles can only make that name worse.
      </p>

      <LexiconEditor initial={lexicon} modelId={config.modelId} />
    </main>
  );
}
