import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VoiceSettings } from "@/components/VoiceSettings";
import { currentSession } from "@/lib/authz";
import { canConfigure } from "@/lib/permissions";

export const metadata: Metadata = { title: "Voice" };

// Admin only, and 404 rather than a redirect, matching /lexicon: the voice is global
// config with the lexicon's blast radius -- a change alters every future generation.
export default async function Page() {
  const session = await currentSession();
  if (!session || !canConfigure(session.user.role)) notFound();

  return <VoiceSettings />;
}
