/**
 * Pure projections /contributions's page.tsx turns a stored envelope into, split out so they
 * can be unit tested without spinning up the page's own database calls -- the same reason
 * lib/npc/resolve.ts's observedFrom is a free function rather than inlined where it's used.
 *
 * npcSummaryFrom pulls in the quests catalogue (flavorsFor), so this file is not node-free the way
 * envelope.ts/contributions.ts are -- ContributionTable.tsx only ever takes NpcSummary/
 * QuestSummary as `import type`, which TypeScript erases entirely, so the client bundle never
 * sees this module's own imports.
 */
import { flavorsFor } from "@/lib/quests/catalogue";
import type { NpcKind, NpcResolution, Provenance } from "@/lib/npc/store";

export type QuestSummary = { title: string; questId: number } | "gossip";

/**
 * The Quest column's content for one contribution.
 *
 * Null for a source with no quest concept at all -- zones and books never carry `quest`/`title`,
 * and there is no ambiguity to flag there the way there is for a quests-source row.
 *
 * "gossip" for a quests-source envelope missing either field: checkEnvelope's other shape for
 * that source is an `npc:<id>` key with neither, and an empty cell would read as "we lost the
 * quest" rather than "this line was never tied to one". A quest id and title only ever arrive
 * together (checkEnvelope requires both `f.quest` and `f.event` for the quest:event key), so a
 * lone field here is stored data that doesn't match that shape rather than a real half-answer,
 * and the safer read is the same as having neither.
 */
export function questFor(row: { source: string; meta: Record<string, string> }): QuestSummary | null {
  if (row.source !== "quests") return null;
  const { quest, title } = row.meta;
  if (quest && title) return { title, questId: Number(quest) };
  return "gossip";
}

/** Who a row's NPC is, in exactly the shape the triage table renders. */
export type NpcSummary = {
  /**
   * Null only for a kind-less envelope with no resolution to fall back on -- the addon reported
   * an id and a name but not what kind of entity it is (resolve.ts's observedFrom refuses to
   * guess, for the reason its own docstring gives), and resolveNpc refuses to touch the store at
   * all without one. The three real rows this table was designed against are exactly this case:
   * filed before the addon reported `kind` at all. Shown with the name and id still, and a kind
   * select added to the "nothing known" state, rather than blank -- a moderator supplying the
   * kind by hand is a reviewed human decision, not the silent auto-guess resolve.ts declines to
   * make at intake.
   */
  npcKind: NpcKind | null;
  npcId: number;
  npcName: string | null;
  race: string | null;
  gender: string | null;
  flavor: string | null;
  provenance: Provenance;
  confirmed: boolean;
  /**
   * flavorsFor(race, gender), or [] when either is unknown -- corpus.ts is server-only, so this
   * is computed once here rather than in the client component that renders it.
   */
  flavorOptions: string[];
};

/**
 * One row's NPC/Speaker column content, from what the envelope itself observed and whatever
 * npc_resolution row (if any) already answers for that (kind, id).
 *
 * The resolution's own `npcKind` wins over the observation's: a resolution can only exist when
 * some envelope -- this one or an earlier one for the same NPC -- carried a kind, which makes it
 * strictly more informed than a kind-less current envelope naming the same id.
 */
export async function npcSummaryFrom(
  observed: { npcKind: NpcKind | null; npcId: number; npcName: string | null },
  resolution: NpcResolution | undefined,
): Promise<NpcSummary> {
  return {
    npcKind: resolution?.npcKind ?? observed.npcKind,
    npcId: observed.npcId,
    npcName: resolution?.npcName ?? observed.npcName,
    race: resolution?.race ?? null,
    gender: resolution?.gender ?? null,
    flavor: resolution?.flavor ?? null,
    provenance: resolution?.provenance ?? "none",
    confirmed: resolution?.confirmed ?? false,
    flavorOptions:
      resolution?.race && resolution?.gender ? await flavorsFor(resolution.race, resolution.gender) : [],
  };
}
