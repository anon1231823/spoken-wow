/**
 * What narrating a zone line needs to know, assembled from the database.
 *
 * The zones site read all of this from pipelines/zones/tools/voice/config.json: which
 * voice, which model, which settings, which pronunciation dictionary. The merged site has
 * one answer to each of those already, shared with the quests side, and two answers to
 * "which model are we generating with" is one too many -- a narrator cut with a different
 * model from the NPC beside it is a difference nobody chose.
 *
 * So:
 *
 *   voice        the `narrator-male` slot on /voices, resolved by name against the
 *                account the request is spending from. It is the same roster entry the
 *                quests side already narrates its stage directions with; the two were
 *                always the same voice on the same account, named the same way, and only
 *                the config file made them look separate.
 *   model
 *   settings     generation_setting, the one row both sections read.
 *   dictionary   pronunciation_lexicon, which owns the ElevenLabs dictionary and is
 *                edited on /lexicon.
 *   format       a constant. ElevenLabs bills characters rather than bytes, so generating
 *                below the plan's best costs the same and buys a worse master.
 *
 * config.json does not go away: the CLI still reads it, and a clone with no database must
 * still be able to generate. It becomes an export of these rows rather than their source.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import "server-only";

import { currentLocator } from "@/lib/generation/dictionary";
import { NARRATOR_VOICE } from "@/lib/generation/narration";
import { type VoiceSettings } from "@/lib/generation/config";
import { currentConfig } from "@/lib/generation/settings";
import { generationStatus } from "@/lib/generation/status";

/**
 * What narrating one line needs, resolved per request from the database.
 *
 * It lived in lib/zones/tools.ts while this shape had to match the pipeline's
 * config.json, because the pipeline held the ElevenLabs client. It does not any more --
 * every request goes through lib/generation/tts.ts -- so the shape belongs here, beside
 * the function that fills it.
 */
export type VoiceConfig = {
  voiceName: string;
  voiceId: string;
  modelId: string;
  /** Recorded against the take. The request takes the API default, which is this. */
  outputFormat: string;
  dictionaryId: string | null;
  dictionaryVersionId: string | null;
  voiceSettings: VoiceSettings;
};

/**
 * The output format every zones take is cut at.
 *
 * A constant rather than a setting. ElevenLabs bills round(characters * rate) and the rate
 * belongs to the plan, not the request, so a smaller format saves nothing and makes a later
 * quality bump a second purchase. package-audio.sh transcodes down for the shipped pack.
 */
export const OUTPUT_FORMAT = "mp3_44100_128";

/**
 * English, stated rather than inferred.
 *
 * Without it a multilingual model guesses the language from the text, and a short line
 * gives it almost nothing to go on. Sent only for models that accept it, which is
 * elevenlabs.mjs's business rather than this module's.
 */
const LANGUAGE_CODE = "en";

export class NarratorMissing extends Error {
  constructor() {
    super(
      `no ElevenLabs voice named "${NARRATOR_VOICE}" on this account. ` +
        "Create it on /voices before generating zone lore.",
    );
    this.name = "NarratorMissing";
  }
}

/**
 * The config for one generation, for one person's account.
 *
 * Takes the key rather than reading one, because whose account this is decides which
 * voices exist: a collaborator generating with their own key sees their own roster, and
 * resolving the narrator against somebody else's would hand ElevenLabs an id that account
 * does not own.
 */
/**
 * `lang` picks the narrator's clone -- each language has its own narrator, like every other
 * voice -- and the settings and lexicon it is spoken with.
 */
export async function narratorConfig(
  apiKey: string,
  lang: Lang = BASE_LANG,
): Promise<VoiceConfig> {
  const [status, config, dictionary] = await Promise.all([
    generationStatus({ apiKey }, lang),
    currentConfig(lang),
    currentLocator(lang),
  ]);

  const voiceId = status.voiceIds.get(NARRATOR_VOICE);
  if (!voiceId) throw new NarratorMissing();

  return {
    voiceName: NARRATOR_VOICE,
    voiceId,
    modelId: config.modelId,
    outputFormat: OUTPUT_FORMAT,
    dictionaryId: dictionary?.dictionaryId ?? null,
    dictionaryVersionId: dictionary?.versionId ?? null,
    voiceSettings: config.voiceSettings,
  };
}
