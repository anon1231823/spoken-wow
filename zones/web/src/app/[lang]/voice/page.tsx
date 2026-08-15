import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VoiceSettings } from "@/components/VoiceSettings";
import { currentSession } from "@/lib/authz";
import { canConfigure } from "@/lib/permissions";

export const metadata: Metadata = { title: "Voice" };

// Admin only, and 404 rather than a redirect, matching /admin: the voice is a
// language's config -- a change alters every future generation in it. Which language
// is the URL's; VoiceSettings reads it from there.
export default async function Page() {
  const session = await currentSession();
  if (!session || !canConfigure(session.user.role)) notFound();

  return <VoiceSettings />;
}
