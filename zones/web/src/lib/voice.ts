// Validation shared by /api/voice and /api/voice/preview, so what can be saved and
// what can be auditioned are the same set by construction.

/** The corpus narrator candidates. Race voices and ElevenLabs stock stay out. */
export const NARRATOR = /^narrator-/;

// What v3 documents as its three stability modes (Creative / Natural / Robust).
// Anything between them is treated as the nearest mode by the model, so offering
// a slider would be a lie.
const STABILITIES = new Set([0, 0.5, 1]);

export function parseSettings(value: unknown): Record<string, number | boolean> | null {
  if (typeof value !== "object" || value === null) return null;
  const { stability, similarity_boost, use_speaker_boost } = value as Record<string, unknown>;

  if (typeof stability !== "number" || !STABILITIES.has(stability)) return null;
  if (typeof similarity_boost !== "number" || similarity_boost < 0 || similarity_boost > 1) {
    return null;
  }
  if (typeof use_speaker_boost !== "boolean") return null;

  return { stability, similarity_boost, use_speaker_boost };
}
