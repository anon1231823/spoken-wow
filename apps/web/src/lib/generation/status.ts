/**
 * What the browser needs to know before it starts spending: which voices exist, and how
 * many characters are left.
 *
 * Memoised with a short TTL because a batch is a loop over one endpoint per line. Asking
 * ElevenLabs which voices exist before each of a hundred lines would triple the request
 * count for an answer that cannot change mid-batch - voices are created on /voices, and
 * that page busts this cache directly.
 *
 * Memoised PER KEY, because the key is which account is being described. Two people with
 * keys on different ElevenLabs accounts see different voices and different balances, and
 * one memo for both would show whichever of them asked first.
 *
 * A failure is reported, never thrown. The page is expected to work with no key at all -
 * that is the state the project was in until a plan was bought - and a batch that cannot
 * show a balance should still be able to run.
 */
import { BASE_LANG, type Lang } from "@/lib/lang";
import { parseCloneName } from "@/lib/voices/clone-name";
import {
  getSubscription,
  listModels,
  listVoices,
  type ElevenLabsOptions,
  type Model,
  type Subscription,
} from "@/lib/voices/elevenlabs";

export type GenerationStatus = {
  /**
   * The slots that have a clone in the language asked about. A slot is the same in every
   * language; its clone is not (clone-name.ts), so English's clones say nothing about German.
   */
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
  /** Every clone in the account, by its full name, whatever its language. */
  clones: Map<string, string>;
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
type Entry = { at: number; value: Promise<GenerationStatus> };
type Holder = { [cacheKey]?: Map<string, Entry> };

function memo(): Map<string, Entry> {
  const holder = globalThis as Holder;
  if (!holder[cacheKey]) holder[cacheKey] = new Map();
  return holder[cacheKey]!;
}

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

/**
 * How many accounts the memo may describe at once.
 *
 * A bound rather than a plain Map, because the keys are per user and a long-lived worker
 * would otherwise hold one entry per person who ever pressed Regenerate. Entries are
 * evicted oldest-first, and an evicted one costs a single extra round trip.
 */
const MEMO_MAX = 32;

async function read(options: ElevenLabsOptions): Promise<GenerationStatus> {
  const fetchedAt = new Date().toISOString();
  try {
    // Both together: they fail for the same reasons (no key, bad key, ElevenLabs down), so
    // serialising them would only make the failure slower.
    const [clones, subscription, models] = await Promise.all([
      listVoices(options),
      getSubscription(options),
      listModels(options),
    ]);
    return {
      voices: [],
      voiceIds: new Map(),
      clones,
      models,
      subscription,
      error: null,
      fetchedAt,
    };
  } catch (error) {
    return {
      voices: [],
      voiceIds: new Map(),
      clones: new Map(),
      models: [],
      subscription: null,
      error: error instanceof Error ? error.message : String(error),
      fetchedAt,
    };
  }
}

/**
 * The memoised account state for one key.
 *
 * A stub bypasses the memo entirely: fetchImpl and baseUrl exist so a test can point at
 * one, and a cache shared between a stub and a real account would be the worst of both.
 *
 * No key means no request either - the caller has none to spend with, and the page renders
 * that as the reason rather than as an empty roster. This is what a signed-out visitor and
 * a collaborator who has not been to /profile both get.
 */
export function generationStatus(
  options: ElevenLabsOptions = {},
  lang: Lang = BASE_LANG,
): Promise<GenerationStatus> {
  return accountStatus(options).then((status) => inLanguage(status, lang));
}

/** The account read once, for every language: which one is asked about is a filter. */
function inLanguage(status: GenerationStatus, lang: Lang): GenerationStatus {
  const voiceIds = new Map<string, string>();
  for (const [name, id] of status.clones) {
    const clone = parseCloneName(name);
    if (clone && clone.lang === lang) voiceIds.set(clone.voice, id);
  }
  return { ...status, voices: [...voiceIds.keys()].sort(), voiceIds };
}

function accountStatus(options: ElevenLabsOptions): Promise<GenerationStatus> {
  if (options.fetchImpl || options.baseUrl) return read(options);
  if (!options.apiKey) return read(options);

  const entries = memo();
  const cached = entries.get(options.apiKey);
  if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;

  // The promise is cached, not the value, so a hundred lines starting at once share one
  // upstream call rather than each finding an empty cache and making their own.
  const value = read(options);
  // Re-inserted rather than updated, so Map's insertion order is recency and the eviction
  // below takes the oldest.
  entries.delete(options.apiKey);
  entries.set(options.apiKey, { at: Date.now(), value });
  while (entries.size > MEMO_MAX) entries.delete(entries.keys().next().value!);
  return value;
}
