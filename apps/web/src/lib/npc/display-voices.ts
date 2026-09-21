/**
 * Which voice an NPC appearance speaks with.
 *
 * The appearance ids come from a client's creature cache (creature-cache.ts). What they mean
 * is in display-voices.json, generated from a local client by
 * pipelines/quests/tools/export_display_voices.py: per appearance, its model file, its NPCSounds
 * voice set, and that set's name where the game's sound files give one.
 *
 * The voice set decides, not the model, because it is what the player hears: Elatrell
 * Featherlight is drawn as a blood elf but greets you in the Skybourne male voice, and his lines
 * should too. In order:
 *
 *   1. A named set on the roster (`tauren-male-warrior`). Exact.
 *   2. A set the roster names by its id, as it does the Skybourne ones (`skybourneelf-male-3776`).
 *      Exact.
 *   3. The model's race and gender (models.ts), with that race-gender's default flavor, or its
 *      bare voice if it has no flavors. A guess about the flavor, so it says so.
 *
 * Anything else -- a creature model, or a race the roster does not have -- has no voice, and
 * the reason says which.
 */
import "server-only";

import { defaultFlavorFor } from "@/lib/quests/catalogue";
import { flavorsOf, isVoice, VOICES, type Gender } from "@/lib/voices/voices";

import table from "./display-voices.json";
import { raceForModel } from "./models";

type Entry = [modelFileId: number, npcSoundsId: number, setVoice: string | null];

const BY_DISPLAY = table as unknown as Record<string, Entry>;

export type DisplayVoice =
  | { voice: { race: string; gender: Gender; flavor: string | null }; exact: boolean; reason: string }
  | { voice: null; exact: false; reason: string };

export async function voiceForDisplay(displayId: number): Promise<DisplayVoice> {
  const entry = BY_DISPLAY[String(displayId)];
  if (!entry) {
    return { voice: null, exact: false, reason: `appearance ${displayId} has no model or voice set on file` };
  }
  const [modelFileId, npcSoundsId, setVoice] = entry;

  if (setVoice && isVoice(setVoice)) {
    const [race, gender, flavor] = setVoice.split("-");
    return { voice: { race, gender: gender as Gender, flavor }, exact: true, reason: `voice set ${setVoice}` };
  }

  const byId = npcSoundsId ? VOICES.find((voice) => voice.flavor === String(npcSoundsId)) : undefined;
  if (byId) return { voice: byId, exact: true, reason: `voice set ${npcSoundsId}` };

  const model = raceForModel(modelFileId);
  if (!model) {
    return { voice: null, exact: false, reason: setVoice ? `${setVoice} is not on the roster` : "not a character model" };
  }
  const { race, gender } = model;
  const bare = `${race}-${gender}`;
  const unmatched = setVoice ? `, ${setVoice} is not on the roster` : "";
  if (isVoice(bare)) {
    return { voice: { race, gender, flavor: null }, exact: !setVoice, reason: `${bare} model${unmatched}` };
  }
  if (flavorsOf(race, gender).length) {
    const flavor = await defaultFlavorFor(race, gender);
    return { voice: { race, gender, flavor }, exact: false, reason: `${bare} model, default flavor${unmatched}` };
  }
  return { voice: null, exact: false, reason: `${bare} is not on the roster` };
}
