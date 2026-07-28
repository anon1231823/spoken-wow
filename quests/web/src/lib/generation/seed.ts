/**
 * A seed that is stable per NPC, so their lines sound like one performer.
 *
 * The twin of seed_for in tts_cli/voice_config.py, down to the checksum: Python uses
 * zlib.crc32 over the decimal NPC id, and node:zlib exposes the same function over the same
 * bytes. seed.test.ts pins values produced by both, because a seeder that merely looks
 * equivalent would give the same NPC two different voices depending on which side made the
 * audio - the exact defect the seed was introduced to fix.
 *
 * Determinism is documented by ElevenLabs as best effort, so this is a strong mitigation
 * for voice drift rather than a guarantee.
 */
import zlib from "node:zlib";

import type { CorpusLine } from "@/lib/corpus";
import type { SeedStrategy } from "./config";

/** ElevenLabs accepts a seed in [0, 4294967295]. */
export const ELEVENLABS_SEED_MAX = 4294967295;

export function seedFor(npcId: number, strategy: SeedStrategy): number | null {
  if (strategy === "none") return null;
  // crc32 is already 32-bit unsigned, so the modulo is a no-op; kept because Python has it
  // and a future strategy might not be.
  return zlib.crc32(String(npcId)) % (ELEVENLABS_SEED_MAX + 1);
}

/**
 * Which NPC's seed a file is generated with.
 *
 * 1,076 files in the corpus are spoken by more than one NPC - a gossip file is keyed on
 * md5(text + race + gender), so every dwarf man with the same line shares one mp3. Python
 * seeds from whichever row it happened to process, which makes the result depend on
 * selection order. Taking the lowest id instead makes a file regenerate the same way no
 * matter which NPC row the button was clicked from, and means the client never gets to
 * choose the seed.
 */
export function canonicalNpcId(lines: Pick<CorpusLine, "npcId">[]): number {
  return lines.reduce((lowest, line) => Math.min(lowest, line.npcId), Infinity);
}
