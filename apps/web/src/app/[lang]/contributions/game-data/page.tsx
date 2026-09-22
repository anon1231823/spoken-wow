import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import GameData from "@/components/GameData";
import { auth } from "@/lib/auth";
import { gameScript } from "@/lib/npc/game-script";
import { listUnconfirmed } from "@/lib/npc/store";
import { canRegenerate } from "@/lib/permissions";

export const metadata: Metadata = { title: "Game data · Spoken" };

export const dynamic = "force-dynamic";

/**
 * Resolving NPCs from a game client's own data.
 *
 * Not linked from anywhere: a tool for whoever has a client to hand, alongside /contributions.
 * The client asks its server about each unresolved NPC, writes the answers to its creature
 * cache, and the cache comes back here to be turned into voices. See lib/npc/game-script.ts,
 * creature-cache.ts and display-voices.ts for the three steps.
 */
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  // 404, matching /contributions, which this writes through.
  if (!session || !canRegenerate(session.user.role)) notFound();

  const pending = await listUnconfirmed("creature");

  return (
    <main className="mx-auto max-w-5xl px-5 pt-6 pb-24">
      <h1 className="text-xl font-semibold">Game data</h1>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        Resolve NPCs from what a game client knows about them: the appearance its server sends,
        which names the model and the voice set the NPC speaks with.
      </p>
      <GameData
        pending={pending.map((row) => ({ npcId: row.npcId, npcName: row.npcName, provenance: row.provenance }))}
        script={gameScript(pending.map((row) => row.npcId))}
      />
    </main>
  );
}
