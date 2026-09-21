/**
 * Which voices this project needs, and what a valid voice name is.
 *
 * The set is derived from the corpus rather than listed here, so a race added to
 * tts_cli/consts.py upstream cannot leave this page quietly missing a voice. The names are
 * the ones tts_cli/voices.py matches on: `race-gender-flavor`, and nothing else is usable,
 * because a stock library voice's name cannot express that mapping.
 *
 * Being a closed set derived from data also makes it a whitelist, which is what keeps a
 * slot name safe to use as a path segment. Same reasoning as isSafeAudioPath in range.ts.
 */
import { corpus } from "@/lib/quests/catalogue";
import { hasNarration, NARRATOR_VOICE } from "@/lib/generation/narration";

export type VoiceSlot = {
  /** e.g. "orc-male-shady" — the ElevenLabs voice name this project resolves by. */
  name: string;
  /** Corpus lines this voice would speak. */
  lineCount: number;
  /** Distinct NPCs using it, which is the better measure of how much it carries. */
  npcCount: number;
};

/**
 * Every voice the corpus needs, by name.
 *
 * Alphabetical rather than busiest-first: at fifty-four voices the list is something you
 * navigate to find one row, and the flavors of a race-gender then sit together.
 *
 * Only generatable lines count: progress text and lines with unresolved template tokens are
 * never voiced, so a voice needed by nothing else is not needed at all.
 */
export async function voiceSlots(): Promise<VoiceSlot[]> {
  const lines = new Map<string, number>();
  const npcs = new Map<string, Set<number>>();

  for (const line of (await corpus()).lines) {
    if (!line.generatable) continue;
    lines.set(line.voice, (lines.get(line.voice) ?? 0) + 1);
    if (!npcs.has(line.voice)) npcs.set(line.voice, new Set());
    npcs.get(line.voice)!.add(line.npcId);
  }

  const derived = [...lines].map(([name, lineCount]) => ({
    name,
    lineCount,
    npcCount: npcs.get(name)!.size,
  }));

  return [...derived, await narratorSlot()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The narrator, which no corpus line names.
 *
 * Every other slot is derived from the corpus so an added race cannot leave this page missing
 * a voice. The narrator has no line of its own - it reads the stage directions inside other
 * NPCs' lines - so it has to be stated. It belongs in the list all the same: the generator
 * depends on it, and a voice you cannot see on /voices is a voice you cannot manage samples
 * for or notice the absence of.
 *
 * Being a constant rather than user input, it does not weaken isVoiceSlot as a whitelist.
 */
async function narratorSlot(): Promise<VoiceSlot> {
  const narrated = (await corpus()).lines.filter((line) => hasNarration(line.text));
  return {
    name: NARRATOR_VOICE,
    lineCount: narrated.length,
    npcCount: new Set(narrated.map((line) => line.npcId)).size,
  };
}

const cacheKey = Symbol.for("wow-voiceover.slots");
type CacheHolder = { [cacheKey]?: { lines: unknown; slots: VoiceSlot[] } };

/**
 * Tied to the catalogue's own array rather than memoised forever: which voices the corpus
 * needs is derived from the lines, and the lines are a table now -- an edit that moves a
 * line to another voice moves this list with it.
 */
export async function slots(): Promise<VoiceSlot[]> {
  const lines = (await corpus()).lines;
  const holder = globalThis as CacheHolder;

  if (!holder[cacheKey] || holder[cacheKey].lines !== lines) {
    holder[cacheKey] = { lines, slots: await voiceSlots() };
  }
  return holder[cacheKey].slots;
}

/**
 * Whether a string names a voice this project uses.
 *
 * Every route that takes a voice name from the URL goes through this before touching the
 * filesystem or ElevenLabs. Membership of a fixed set, not pattern matching: `../` and an
 * absolute path fail for the same reason `orc-mail` does.
 */
export async function isVoiceSlot(name: string): Promise<boolean> {
  return (await slots()).some((slot) => slot.name === name);
}
