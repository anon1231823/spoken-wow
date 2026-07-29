/**
 * What a preview should say.
 *
 *   word      the name alone. The phonemes with nothing around them - the fastest way to
 *             hear whether a transcription is right, and the one that isolates the vowel
 *             being argued about.
 *   sentence  the name in a real corpus line. Slower and dearer, but a name in isolation
 *             gets list intonation and a final fall, and prosody is the half of a
 *             pronunciation that only shows up in context.
 *
 * Both are cached, and independently: they are different text, so previewKey separates them
 * without needing to know the mode exists.
 *
 * Its own file, apart from preview.ts, for the reason config.ts is apart from files.ts: the
 * editor renders a button per mode and so needs these as values, while preview.ts reaches
 * for node:crypto, node:fs and the corpus. Importing the modes from there put all three in
 * the browser bundle, and the build - not the type checker - was what noticed.
 */

export const PREVIEW_MODES = ["word", "sentence"] as const;
export type PreviewMode = (typeof PREVIEW_MODES)[number];

export function isPreviewMode(value: unknown): value is PreviewMode {
  return typeof value === "string" && (PREVIEW_MODES as readonly string[]).includes(value);
}
