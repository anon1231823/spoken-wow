import { Suspense } from "react";

import Explorer from "@/components/Explorer";

export default function Page() {
  return (
    <main className="mx-auto max-w-4xl px-5 pt-6 pb-36">
      <h1 className="text-xl font-semibold">VoiceOver Explorer</h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm">
        Find and play voicelines by NPC or quest. Read-only: nothing here writes to the
        corpus, the audio store, or your game install.
      </p>
      <Suspense>
        <Explorer />
      </Suspense>
    </main>
  );
}
