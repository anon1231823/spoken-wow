/**
 * What a client's creature cache says about the NPCs this project is waiting on.
 *
 * The page parses creaturecache.wdb in the browser and posts only `npcId -> appearance ids`;
 * this answers with a proposed voice for each NPC we have a row for (display-voices.ts), next
 * to what that row says now. Nothing is written here: applying goes through
 * api/contributions/npc like any other moderator answer, one NPC at a time, so the page can
 * show which ones landed. Collaborator, matching that route.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import type { CachedCreature } from "@/lib/npc/creature-cache";
import { voiceForDisplay, type DisplayVoice } from "@/lib/npc/display-voices";
import { getResolutions, resolutionKey } from "@/lib/npc/store";

export const dynamic = "force-dynamic";

// A real cache holds a few hundred creatures; a long-played one a few thousand.
const MAX_CREATURES = 50_000;

export type GameDataProposal = {
  npcId: number;
  npcName: string | null;
  current: { race: string | null; gender: string | null; flavor: string | null; provenance: string; confirmed: boolean };
  displayId: number;
  /** More than one appearance, and they do not all speak with the same voice. */
  varies: boolean;
} & Pick<DisplayVoice, "voice" | "exact" | "reason">;

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { creatures?: unknown } | null;
  const creatures = Array.isArray(body?.creatures) ? (body.creatures as CachedCreature[]) : null;
  if (!creatures || creatures.length > MAX_CREATURES) {
    return Response.json({ error: "expected { creatures: [...] }" }, { status: 400 });
  }
  const valid = creatures.filter(
    (c) =>
      Number.isInteger(c?.npcId) && c.npcId > 0 && c.npcId <= 2147483647 &&
      Array.isArray(c.displays) && c.displays.length > 0 &&
      c.displays.every((d) => Number.isInteger(d?.displayId) && typeof d.probability === "number"),
  );

  const rows = await getResolutions(valid.map((c) => ({ npcKind: "creature" as const, npcId: c.npcId })));
  const memo = new Map<number, Promise<DisplayVoice>>();
  const resolve = (displayId: number) => {
    if (!memo.has(displayId)) memo.set(displayId, voiceForDisplay(displayId));
    return memo.get(displayId)!;
  };

  const proposals: GameDataProposal[] = [];
  for (const creature of valid) {
    const row = rows.get(resolutionKey("creature", creature.npcId));
    if (!row) continue;
    // The likeliest appearance speaks for the NPC; `varies` flags the ones where it matters.
    const displays = [...creature.displays].sort((a, b) => b.probability - a.probability);
    const answers = await Promise.all(displays.map((d) => resolve(d.displayId)));
    const name = (a: DisplayVoice) => (a.voice ? `${a.voice.race}-${a.voice.gender}-${a.voice.flavor ?? ""}` : "");
    proposals.push({
      npcId: creature.npcId,
      npcName: row.npcName,
      current: {
        race: row.race, gender: row.gender, flavor: row.flavor,
        provenance: row.provenance, confirmed: row.confirmed,
      },
      displayId: displays[0].displayId,
      varies: new Set(answers.map(name)).size > 1,
      voice: answers[0].voice,
      exact: answers[0].exact,
      reason: answers[0].reason,
    } as GameDataProposal);
  }

  proposals.sort((a, b) => Number(a.current.confirmed) - Number(b.current.confirmed) || a.npcId - b.npcId);
  return Response.json({ proposals, cached: valid.length });
}
