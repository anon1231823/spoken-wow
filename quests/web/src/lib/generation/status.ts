/**
 * What the browser needs to know before it starts spending: which voices exist, and how
 * many characters are left.
 *
 * Memoised with a short TTL because a batch is a loop over one endpoint per line. Asking
 * ElevenLabs which voices exist before each of a hundred lines would triple the request
 * count for an answer that cannot change mid-batch - voices are created on /voices, and
 * that page busts this cache directly.
 *
 * A failure is reported, never thrown. The page is expected to work with no key at all -
 * that is the state the project was in until a plan was bought - and a batch that cannot
 * show a balance should still be able to run.
 */
import { getSubscription, listVoices, type Subscription } from "@/lib/voices/elevenlabs";

export type GenerationStatus = {
  /** Voice names in the account that match a race-gender slot. */
  voices: string[];
  subscription: Subscription | null;
  /** Why the above is empty or null, if it is. */
  error: string | null;
  fetchedAt: string;
};

export const STATUS_TTL_MS = 60_000;

const cacheKey = Symbol.for("wow-voiceover.generation-status");
type Holder = { [cacheKey]?: { at: number; value: Promise<GenerationStatus> } };

/**
 * Drop the memo.
 *
 * Called after a voice is created or replaced: without it a slot filled a moment ago still
 * reads as missing for up to a minute, and the Regenerate button stays disabled with no
 * explanation the operator can act on.
 */
export function invalidateStatus(): void {
  delete (globalThis as Holder)[cacheKey];
}

async function read(): Promise<GenerationStatus> {
  const fetchedAt = new Date().toISOString();
  try {
    // Both together: they fail for the same reasons (no key, bad key, ElevenLabs down), so
    // serialising them would only make the failure slower.
    const [voices, subscription] = await Promise.all([listVoices(), getSubscription()]);
    return { voices: [...voices.keys()].sort(), subscription, error: null, fetchedAt };
  } catch (error) {
    return {
      voices: [],
      subscription: null,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt,
    };
  }
}

export function generationStatus(): Promise<GenerationStatus> {
  const holder = globalThis as Holder;
  const cached = holder[cacheKey];
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;

  // The promise is cached, not the value, so a hundred lines starting at once share one
  // upstream call rather than each finding an empty cache and making their own.
  const value = read();
  holder[cacheKey] = { at: Date.now(), value };
  return value;
}
