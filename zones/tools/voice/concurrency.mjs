// How many requests may be in flight at once.
//
// ElevenLabs limits concurrency per plan and per model family and publishes the
// numbers, so the answer comes from the account rather than from a constant
// somebody tuned once. Ported from ../wow-voiceover/web/src/lib/generation/
// concurrency.ts, which measured these against this same account.
//
// Pure on purpose: nothing here touches the network or the disk, so the budget
// can be reasoned about and tested without an account.

// Flash gets its own, higher limits. Everything else -- multilingual v2, v3 and
// turbo -- takes the standard column. Turbo sits with standard because the
// published table names only flash in the higher column: being wrong towards
// flash costs a wave of 429s, being wrong towards standard costs some time, and
// the cheaper mistake is the one to make.
export function familyOf(modelId) {
  return modelId.includes("flash") ? "flash" : "standard";
}

const LIMITS = {
  free: { standard: 2, flash: 4 },
  starter: { standard: 3, flash: 6 },
  creator: { standard: 5, flash: 10 },
  pro: { standard: 10, flash: 20 },
  scale: { standard: 15, flash: 30 },
  business: { standard: 15, flash: 30 },
  // The docs say "elevated" rather than a number. Business is the highest figure
  // they publish, and the cool-down turns an over-estimate into a slower batch
  // rather than a failed one.
  enterprise: { standard: 15, flash: 30 },
};

// A tier this does not recognise gets the free limit, not the highest: finding
// out the plan is unknown must not be the moment this code is most aggressive.
export function tierLimit(tier, family) {
  if (!tier) return 2;
  const known = LIMITS[String(tier).trim().toLowerCase()];
  if (!known) return 2;
  return known[family];
}

export function budgetFor(tier, modelId) {
  return Math.max(1, tierLimit(tier, familyOf(modelId)));
}

export const COOL_DOWN_MS = 60_000;

// The budget, halved while a rate limit is recent.
//
// A 429 means the published number is wrong for right now whatever the table
// says -- another process on the same key, or a limit that has moved. Backing
// off and staying backed off for a minute is the circuit breaker ElevenLabs
// recommends in place of retrying into a wall.
export function afterRateLimit(budget, rateLimitedAt, now) {
  if (rateLimitedAt === null || now - rateLimitedAt > COOL_DOWN_MS) return budget;
  return Math.max(1, Math.floor(budget / 2));
}

//------------------------------------------------------------------------------

// A semaphore whose limit can change while work is in flight, which is what lets
// a 429 shrink the batch without tearing down and restarting the workers.
export class Limiter {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  setLimit(limit) {
    this.limit = Math.max(1, limit);
    this.#pump();
  }

  acquire() {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.#pump();
    });
  }

  release() {
    this.active--;
    this.#pump();
  }

  #pump() {
    while (this.active < this.limit && this.waiting.length) {
      this.active++;
      this.waiting.shift()();
    }
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
