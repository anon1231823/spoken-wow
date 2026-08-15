import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PronunciationSettings } from "@/components/PronunciationSettings";
import { currentSession } from "@/lib/authz";
import { canConfigure } from "@/lib/permissions";

export const metadata: Metadata = { title: "Pronunciation" };

// Admin only, and 404 rather than a redirect, matching /voice: the dictionary applies
// to every future generation in the language. Which language is the URL's.
//
// For now this page holds one thing, the language's ElevenLabs dictionary id. The
// rule editor -- the respellings this project applies before synthesis -- is still
// one file for every language (tools/voice/pronunciation.json) and is what this page
// grows into.
export default async function Page() {
  const session = await currentSession();
  if (!session || !canConfigure(session.user.role)) notFound();

  return <PronunciationSettings />;
}
