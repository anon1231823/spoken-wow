import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import GenerationSettings from "@/components/GenerationSettings";
import VoiceSlotList from "@/components/VoiceSlotList";
import { readApiKey } from "@/lib/api-key";
import { auth } from "@/lib/auth";
import { readSettings } from "@/lib/generation/settings";
import { canManageVoices } from "@/lib/permissions";
import { generationStatus } from "@/lib/generation/status";
import { listSamples, type Sample } from "@/lib/voices/samples";
import { slots } from "@/lib/voices/slots";

export const metadata: Metadata = { title: "Voices · Spoken" };

// The account state is read live on every view: a voice created in the ElevenLabs dashboard
// rather than here should still show up, since tts_cli/voices.py would find it either way.
export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });

  // 404 rather than a redirect, matching /admin: a member has no business learning that
  // this page exists.
  if (!session || !canManageVoices(session.user.role)) notFound();

  const all = slots();

  // One memoised read of the account: which voices exist, which models the plan allows, and
  // what is left of the character budget. The page has to be useful before the ElevenLabs key
  // exists — that is the state the project was in until a plan was bought — so a failure here
  // is reported, not thrown.
  // The admin's own key, because there is no server-wide one: the roster this page shows is
  // the roster of whichever account is about to be generated from. A row that will not open
  // reads as none, and the message below covers both.
  const apiKey = await readApiKey(session.user.id).catch(() => null);
  const account = await generationStatus(apiKey ? { apiKey } : {});
  const existing = account.error && account.voiceIds.size === 0 ? null : account.voiceIds;
  const error = apiKey
    ? account.error
    : "No ElevenLabs key on your account. Set one in your profile to see which voices exist" +
      " and to create them.";

  // Twenty readdir calls, so the roster arrives with its clip counts already filled in
  // rather than each row fetching its own once expanded.
  const samples: Record<string, Sample[]> = Object.fromEntries(
    await Promise.all(all.map(async (slot) => [slot.name, await listSamples(slot.name)] as const)),
  );

  const created = existing ? all.filter((slot) => existing.has(slot.name)).length : 0;

  const settings = await readSettings();

  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">Voices</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        The corpus needs {all.length} voices: one per race, gender and flavor — the two or
        three distinct voice sets the game gives every race-gender. The generator resolves
        them by name, so a voice only counts once it is called exactly{" "}
        <code className="text-foreground">race-gender-flavor</code> in the ElevenLabs account.
        {existing && ` ${created} of ${all.length} exist.`}
      </p>

      {error && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-5 rounded-md border px-3 py-2 text-sm"
        >
          Could not read the ElevenLabs account: {error}
        </div>
      )}

      <GenerationSettings initial={settings} models={account.models} />

      <VoiceSlotList
        slots={all}
        existing={existing ? [...existing.keys()] : null}
        initialSamples={samples}
      />
    </main>
  );
}
