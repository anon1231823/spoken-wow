/**
 * How many regenerations may be in flight at once.
 *
 * ElevenLabs limits concurrent requests per plan and per model family, and publishes the
 * numbers. This turns the tier the account reports and the model in force into a budget, so
 * the answer comes from the account rather than from a constant somebody tuned once.
 *
 * Pure, and it must stay that way: nothing here may import anything that touches the network
 * or the disk, so this can be reasoned about - and tested - without an account.
 */
export type ModelFamily = "flash" | "standard";

/**
 * Flash gets its own, higher limits. Everything else - multilingual v2, v3 and turbo - takes
 * the standard column.
 *
 * Turbo sits here rather than with flash because the published table names only flash in the
 * higher column. Being wrong towards flash costs a wave of 429s and a halved budget; being
 * wrong towards standard costs some time. The cheaper mistake is the one to make.
 */
export function familyOf(modelId: string): ModelFamily {
  return modelId.includes("flash") ? "flash" : "standard";
}

const LIMITS: Record<string, Record<ModelFamily, number>> = {
  free: { standard: 2, flash: 4 },
  starter: { standard: 3, flash: 6 },
  creator: { standard: 5, flash: 10 },
  pro: { standard: 10, flash: 20 },
  scale: { standard: 15, flash: 30 },
  business: { standard: 15, flash: 30 },
  // The docs say "elevated" rather than a number. Business is the highest figure they do
  // publish, and the cool-down below turns an over-estimate into a slower batch, not a
  // failed one.
  enterprise: { standard: 15, flash: 30 },
};

/**
 * The published limit for a tier, or the smallest one.
 *
 * A tier this does not recognise is the free limit, not the highest: the page is expected to
 * work with no ElevenLabs key at all, and discovering a missing plan must not be the moment
 * the code is at its most aggressive. `tier` is upstream text, so it is matched loosely.
 */
export function tierLimit(tier: string | null, family: ModelFamily): number {
  if (!tier) return 2;
  const known = LIMITS[tier.trim().toLowerCase()];
  if (!known) return 2;
  return known[family];
}

/**
 * The limit, less one slot held back for interactive work.
 *
 * Without the reserve a running batch would fill the plan and the single-line Regenerate
 * button - and the pronunciation previews on /lexicon - would sit behind it collecting 429s.
 */
export function budgetFor(tier: string | null, modelId: string): number {
  return Math.max(1, tierLimit(tier, familyOf(modelId)) - 1);
}

/**
 * Connections held for something other than a job in flight.
 *
 * The leader keeps one checked out for as long as it leads, better-auth resolves a session
 * out of the same pool on every request, and the single-line Regenerate button costs two of
 * its own. Eight leaves those with room while a batch runs.
 */
export const POOL_RESERVE = 8;

/**
 * The plan's budget, capped at what the connection pool can actually serve.
 *
 * Each job in flight holds two clients at once: the per-file advisory lock in lock.ts for the
 * length of the ElevenLabs call, and a second one inside it for the transaction that marks
 * the new version current. A budget above `(max - reserve) / 2` therefore fills the pool with
 * jobs that are all waiting on connections none of them will release - a deadlock the process
 * does not recover from, since better-auth shares the pool and HTTP stops being served too.
 *
 * Derived from the pool's configured maximum rather than written down as a number, so raising
 * one without the other cannot quietly reintroduce that.
 */
export function clampToPool(budget: number, poolMax: number): number {
  return Math.max(1, Math.min(budget, Math.floor((poolMax - POOL_RESERVE) / 2)));
}

export const COOL_DOWN_MS = 60_000;

/**
 * The budget, halved while a rate limit is recent.
 *
 * A 429 means the published number is wrong for right now, whatever the table says - another
 * process on the same key, or a limit that has moved. Backing off and staying backed off for
 * a minute is the circuit breaker ElevenLabs recommends in place of retrying into a wall.
 */
export function afterRateLimit(
  budget: number,
  rateLimitedAt: number | null,
  now: number,
): number {
  if (rateLimitedAt === null || now - rateLimitedAt > COOL_DOWN_MS) return budget;
  return Math.max(1, Math.floor(budget / 2));
}
