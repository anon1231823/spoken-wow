/**
 * Links out to Wowhead's Classic and Anniversary databases.
 *
 * `/classic/` is the Classic Era branch of the site, which is the game this corpus is taken
 * from - the bare `/quest=` path is retail, where a vanilla quest may have been changed out
 * of recognition or removed. The distinction matters most on exactly the lines worth looking
 * up: the ones that look wrong here.
 *
 * `/forever/` is the Anniversary branch: two branches exist here, not one, because the corpus
 * and the contribution queue are not answering about the same game. The corpus is built from
 * the 1.12 world the Classic Era client speaks, but a pasted contribution comes from whatever
 * client the addon it's built for runs on -- SpokenPlayer's envelope names the Anniversary
 * realm, which has content /classic/ has never heard of (this branch's own case: NPC 205729,
 * a post-vanilla quest-giver the corpus has no line for at all). Pointing every contribution's
 * lookup at /classic/ would silently 404 on exactly the rows most worth checking by hand.
 *
 * `npcType` is the corpus's own word for which id space an entity lives in, and Wowhead
 * spells two of the three differently. Mapped in one place rather than at each call site,
 * because creature 68 is a Stormwind City Guard and gameobject 68 is a Wanted Poster - a
 * wrong segment silently opens the wrong page rather than a missing one.
 *
 * No node imports: the row renders in the browser.
 */
import type { NpcType } from "./line-fields";

const SEGMENT: Record<NpcType, string> = {
  creature: "npc",
  gameobject: "object",
  item: "item",
};

export function wowheadQuestUrl(questId: number): string {
  return `https://www.wowhead.com/classic/quest=${questId}`;
}

export function wowheadEntityUrl(npcType: NpcType, npcId: number): string {
  return `https://www.wowhead.com/classic/${SEGMENT[npcType]}=${npcId}`;
}

/** The same entity, on the branch a contribution's own client actually runs -- see above. */
export function wowheadForeverUrl(npcType: NpcType, npcId: number): string {
  return `https://www.wowhead.com/forever/${SEGMENT[npcType]}=${npcId}`;
}
