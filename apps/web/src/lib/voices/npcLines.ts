/**
 * The game's own clips for a voice, which is what a clone is made from.
 *
 * voice/npc-lines holds Blizzard's NPC greeting barks sorted into
 * `<race-gender>/<flavor>/`, which is exactly the shape of a voice slot name. So a slot
 * addresses its own source material by splitting on the last dash - no mapping table, and
 * nothing to keep in sync when a flavor is added.
 */
import { BASE_LANG } from "@/lib/lang";
import { parseCloneName } from "./clone-name";
import fs from "node:fs/promises";
import path from "node:path";

import { NPC_LINES_DIR } from "@/lib/paths";
import { isVoiceSlot } from "./slots";

/**
 * Absolute paths of the clips for a voice, oldest name first.
 *
 * Empty for a slot the game has no voice sets for: narrator-male is a pseudo-race for
 * gameobjects, and bloodelf-female is one Sylvanas line from a later expansion's model.
 * Empty rather than throwing, because "nothing to seed from" is a normal state for those
 * two and the caller has to handle it either way.
 */
/**
 * `clone` is a clone's name (clone-name.ts). Another language's barks are its own client's,
 * spoken by its own actors, and sit under <npc lines>/<lang>/ in the same layout; English's
 * stay where they are.
 */
export async function npcLineClips(clone: string): Promise<string[]> {
  const parsed = parseCloneName(clone);
  if (!parsed || !(await isVoiceSlot(parsed.voice))) throw new Error(`unknown voice slot ${clone}`);

  const parts = parsed.voice.split("-");
  if (parts.length !== 3) return [];
  const root = parsed.lang === BASE_LANG ? NPC_LINES_DIR : path.join(NPC_LINES_DIR, parsed.lang);
  const dir = path.join(root, `${parts[0]}-${parts[1]}`, parts[2]);

  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }

  return names
    .filter((name) => !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(dir, name));
}
