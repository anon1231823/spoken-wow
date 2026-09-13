/**
 * Naming rules for stored clips.
 *
 * Separate from samples.ts because the browser needs these too, and samples.ts imports
 * node:fs and node:crypto — importing it from a client component fails the webpack build
 * with "Reading from node:crypto is not handled by plugins". Nothing here may gain a Node
 * dependency for that reason.
 */

/**
 * Stored names are generated server-side and never taken from the client, so this only has
 * to recognise our own shape. It is still enforced on read: a name arriving from a URL must
 * not be able to escape the voice directory.
 */
const STORED_NAME = /^[0-9a-f]{8}-[A-Za-z0-9._-]{1,64}\.(mp3|wav|m4a|mp4|ogg|flac|webm)$/;

export function isStoredSampleName(name: string): boolean {
  return STORED_NAME.test(name) && !name.includes("..");
}

/** A stored name without its uniqueness prefix — what a human should be shown. */
export function displayName(file: string): string {
  return file.replace(/^[0-9a-f]{8}-/, "");
}
