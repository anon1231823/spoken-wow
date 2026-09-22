import GenerationSettings from "@/components/GenerationSettings";
import { viewerOf } from "@/lib/grants/store";
import { BASE_LANG } from "@/lib/lang";
import { pageLang } from "@/lib/lang-server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import LexiconEditor from "@/components/LexiconEditor";
import { readApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { readLexicon } from "@/lib/generation/dictionary";
import { previewCache, voicePicker } from "@/lib/generation/preview";
import { readSettings } from "@/lib/generation/settings";
import { generationStatus } from "@/lib/generation/status";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pronunciation · Spoken" };

// The lexicon is a database row and the sync state changes underneath it, so nothing here
// can be cached between views.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const lang = await pageLang(params);
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /voices and /admin: a member has no business
  // learning that this page exists. Per language: each has its own lexicon, looked after by
  // whoever configures it.
  if (!session || !can(await viewerOf(session), "configure", lang)) notFound();
  const english = lang === BASE_LANG;

  // The admin's own key: which voices the account has decides which one each preview would
  // be spoken in, and with no key there are none - every button then simply says it costs
  // money, which is true and harmless.
  const apiKey = await readApiKey(session.user.id).catch(() => null);

  const [lexicon, settings, status] = await Promise.all([
    readLexicon(lang),
    readSettings(lang),
    generationStatus(apiKey ? { apiKey } : {}, lang),
  ]);
  const config = settings.config;

  // Resolved here rather than in the browser: knowing whether a preview is cached means
  // knowing which corpus sentence it would use, which is a pass over 17,507 lines. Doing it
  // once on the server beats 268 round trips, and it is what lets each button say up front
  // whether pressing it costs money.
  //
  // English only: the preview sentences are English's (see the preview route).
  const cached = english
    ? await previewCache(lexicon.entries, voicePicker(status.voiceIds), config)
    : {};

  return (
    <main className="mx-auto max-w-5xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Pronunciation</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        How ElevenLabs should say the names the corpus uses. Each entry becomes a phoneme rule
        in a pronunciation dictionary, matched case-insensitively at word boundaries, and every
        line generated afterwards is spoken with it. Only names a plain reader gets wrong belong
        here — a rule for a name it already handles can only make that name worse.
      </p>

      {/* Another language's model and voice settings live here, beside its lexicon: whoever
          configures a language may set both, while /voices -- where English's are -- is the
          global admin's, since the voices themselves are shared by every language. */}
      {!english && <GenerationSettings initial={settings} models={status.models} />}

      <LexiconEditor initial={lexicon} modelId={config.modelId} initialCache={cached} />
    </main>
  );
}
