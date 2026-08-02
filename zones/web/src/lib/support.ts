// Where the money goes.
//
// One constant rather than two literals, because it is now named in two unrelated places
// -- the header, and the thank-you at the end of the feedback dialog -- and a donation
// link that is right in one of them and stale in the other is worse than not having it.
// Client-safe on purpose: both callers are client components.

export const SUPPORT_URL = "https://buymeacoffee.com/rustykey";

/**
 * Why we ask, in one sentence, for the places that have room for it.
 *
 * Kept next to the URL so the reason and the destination cannot drift apart.
 */
export const SUPPORT_REASON =
  "Generating the narration costs real money per line, and the audio has to be hosted somewhere.";
