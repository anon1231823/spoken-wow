import { Suspense } from "react";

import Explorer from "@/components/Explorer";

export default function Page() {
  return (
    <main>
      <h1>VoiceOver Explorer</h1>
      <p className="tagline">
        Find and play voicelines by NPC or quest. Read-only: nothing here writes to the
        corpus, the audio store, or your game install.
      </p>
      <Suspense>
        <Explorer />
      </Suspense>
    </main>
  );
}
