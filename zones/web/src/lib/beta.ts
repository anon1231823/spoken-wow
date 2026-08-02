// What "beta" means here.
//
// One constant rather than the same paragraphs typed out wherever they are needed, for
// SUPPORT_REASON's reason: the explanation is owed to anybody who clicks the badge in
// the header and to anybody reading the sound pack's description before downloading
// ~400MB of it, and a disclaimer that is current in one of those places and stale in
// the other is worse than not having one.
//
// The addon half of that pair cannot import this file. `addon/ZoneLore/Audio.lua` and
// `addon/ZoneLoreAudio/README.md` carry the same claim in their own words, and the four
// of them are meant to be edited in one sitting -- the voice stops being "in redesign"
// everywhere on the same day.

/** What the badge itself says. Lowercase: it is a qualifier on the logo, not a heading. */
export const BETA_LABEL = "beta";

export const BETA_TITLE = "ZoneLore is in beta";

/**
 * The disclaimer, one string per paragraph.
 *
 * Ordered so that somebody who stops reading after the first one has still been told
 * the thing that matters: what they are hearing is not the finished voice.
 */
export const BETA_BODY: readonly string[] = [
  "Everything here works end to end — every Classic Era zone and subzone has lore, and all 1353 lines of it are narrated. What it is not yet is finished. This release is a proof of concept: it exists to show what the addon does, with a voice that was picked to get all of it recorded at once.",
  "That voice is being redesigned. The delivery is flat in long descriptions, names are pronounced inconsistently between lines, and some entries read as a wall of text rather than as lore being told to you. None of that is fixable line by line — it is a different voice and a different pass over the whole script.",
  "Re-recording means generating all 1353 lines again. Every one of them costs money to synthesise and time to listen back to, which is the honest reason this is taking a while rather than shipping next week. It is happening in batches, as it can be paid for.",
];
