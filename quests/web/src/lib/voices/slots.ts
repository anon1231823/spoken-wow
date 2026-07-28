/**
 * Which voices this project needs, and what a valid voice name is.
 *
 * The set is derived from the corpus rather than listed here, so a race added to
 * tts_cli/consts.py upstream cannot leave this page quietly missing a voice. The names are
 * the ones tts_cli/voices.py matches on: `race-gender`, and nothing else is usable, because
 * a stock library voice's name cannot express that mapping.
 *
 * Being a closed set derived from data also makes it a whitelist, which is what keeps a
 * slot name safe to use as a path segment. Same reasoning as isSafeAudioPath in range.ts.
 */
import { loadCorpus } from "@/lib/corpus";

export type VoiceSlot = {
  /** e.g. "orc-male" — the ElevenLabs voice name this project resolves by. */
  name: string;
  /** Corpus lines this voice would speak. */
  lineCount: number;
  /** Distinct NPCs using it, which is the better measure of how much it carries. */
  npcCount: number;
};

/**
 * Every voice the corpus needs, busiest first.
 *
 * Only generatable lines count: progress text and lines with unresolved template tokens are
 * never voiced, so a voice needed by nothing else is not needed at all.
 */
export function voiceSlots(): VoiceSlot[] {
  const lines = new Map<string, number>();
  const npcs = new Map<string, Set<number>>();

  for (const line of loadCorpus().lines) {
    if (!line.generatable) continue;
    lines.set(line.voice, (lines.get(line.voice) ?? 0) + 1);
    if (!npcs.has(line.voice)) npcs.set(line.voice, new Set());
    npcs.get(line.voice)!.add(line.npcId);
  }

  return [...lines]
    .map(([name, lineCount]) => ({ name, lineCount, npcCount: npcs.get(name)!.size }))
    .sort((a, b) => b.npcCount - a.npcCount || a.name.localeCompare(b.name));
}

const cacheKey = Symbol.for("wow-voiceover.slots");
type CacheHolder = { [cacheKey]?: VoiceSlot[] };

export function slots(): VoiceSlot[] {
  const holder = globalThis as CacheHolder;
  if (!holder[cacheKey]) holder[cacheKey] = voiceSlots();
  return holder[cacheKey]!;
}

/**
 * Whether a string names a voice this project uses.
 *
 * Every route that takes a voice name from the URL goes through this before touching the
 * filesystem or ElevenLabs. Membership of a fixed set, not pattern matching: `../` and an
 * absolute path fail for the same reason `orc-mail` does.
 */
export function isVoiceSlot(name: string): boolean {
  return slots().some((slot) => slot.name === name);
}
