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
import {
  getSubscription,
  listModels,
  listVoices,
  type ElevenLabsOptions,
  type Model,
  type Subscription,
} from "@/lib/voices/elevenlabs";

export type GenerationStatus = {
  /** Voice names in the account that match a race-gender slot. */
  voices: string[];
  /**
   * The same voices as name -> id, which is what generating actually needs.
   *
   * Carried here rather than looked up per line, or a hundred-line batch would make a
   * hundred extra calls for an answer that cannot change mid-batch. The cost is a window of
   * up to STATUS_TTL_MS in which a voice replaced in the ElevenLabs dashboard - same name,
   * new id - would still generate against the old one. /voices busts this cache when it
   * replaces a voice, which closes the window for the path that actually does it.
   */
  voiceIds: Map<string, string>;
  /**
   * Models the account may generate with.
   *
   * Read rather than hardcoded: a list in the code goes stale the moment ElevenLabs ships a
   * model, and the settings page then withholds an option the plan already allows.
   */
  models: Model[];
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

async function read(options: ElevenLabsOptions): Promise<GenerationStatus> {
  const fetchedAt = new Date().toISOString();
  try {
    // Both together: they fail for the same reasons (no key, bad key, ElevenLabs down), so
    // serialising them would only make the failure slower.
    const [voiceIds, subscription, models] = await Promise.all([
      listVoices(options),
      getSubscription(options),
      listModels(options),
    ]);
    return {
      voices: [...voiceIds.keys()].sort(),
      voiceIds,
      models,
      subscription,
      error: null,
      fetchedAt,
    };
  } catch (error) {
    return {
      voices: [],
      voiceIds: new Map(),
      models: [],
      subscription: null,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt,
    };
  }
}

/**
 * The memoised account state.
 *
 * Passing options bypasses the memo entirely: they exist so a test can point at a stub, and
 * a cache shared between a stub and the real account would be the worst of both.
 */
export function generationStatus(options: ElevenLabsOptions = {}): Promise<GenerationStatus> {
  if (options.fetchImpl || options.baseUrl || options.apiKey) return read(options);

  const holder = globalThis as Holder;
  const cached = holder[cacheKey];
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;

  // The promise is cached, not the value, so a hundred lines starting at once share one
  // upstream call rather than each finding an empty cache and making their own.
  const value = read({});
  holder[cacheKey] = { at: Date.now(), value };
  return value;
}
