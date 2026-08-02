// Re-cutting a line, and watching a batch of them.
//
// This is the only code in the app that spends money. It calls the same
// tools/voice/elevenlabs.mjs the CLI calls, records takes through the same
// store.mjs, and re-exports the manifest and lookup afterwards, so a clip
// regenerated here is indistinguishable from one generate.mjs made.
//
// NO QUEUE TABLES. ../wow-voiceover moved its batch loop into Postgres because two
// pm2 workers and several admins share one billing account, and a closed tab used to
// strand a batch halfway. Here there is one person, one machine and one process: the
// work runs server-side so closing the tab does not stop it, and progress lives in
// memory. The honest cost is that restarting the dev server loses an in-flight batch.

import "server-only";

import { stat } from "node:fs/promises";

import { catalogue, type CatalogueEntry } from "./catalogue";
import { query } from "./db";
import {
  COOL_DOWN_MS,
  Limiter,
  afterRateLimit,
  apiKey,
  budgetFor,
  buildLookup,
  durationOf,
  exportManifest,
  fetchTier,
  insertTake,
  loadConfig,
  loadManifest,
  measureRates,
  resolveDictionary,
  resolveVoiceId,
  restoreTake,
  synthesize,
  writeAudio,
  type VoiceConfig,
} from "./tools";

export type JobState = "pending" | "running" | "done" | "failed";

export type Job = {
  lineId: string;
  name: string;
  zoneName: string;
  chars: number;
  state: JobState;
  version?: number;
  credits?: number | null;
  error?: string;
};

export type Batch = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  jobs: Job[];
  /** Set when the whole run gave up: a quota or auth failure, or a stop request. */
  stoppedBecause: string | null;
  stopping: boolean;
};

export type Quote = {
  lines: number;
  characters: number;
  credits: number | null;
  /** Credits per character, measured from what has actually been billed. */
  rate: number | null;
  measuredFrom: number;
};

// Batches live here rather than in a module variable, because `next dev` re-evaluates
// modules on edit and a running batch would otherwise become unreachable while still
// spending credits.
const globalForBatches = globalThis as unknown as {
  zoneloreBatches?: Map<string, Batch>;
};

function batches(): Map<string, Batch> {
  if (!globalForBatches.zoneloreBatches) globalForBatches.zoneloreBatches = new Map();
  return globalForBatches.zoneloreBatches;
}

export function getBatch(id: string): Batch | null {
  return batches().get(id) ?? null;
}

export function latestBatch(): Batch | null {
  let newest: Batch | null = null;
  for (const batch of batches().values()) {
    if (!newest || batch.startedAt > newest.startedAt) newest = batch;
  }
  return newest;
}

export function stopBatch(id: string): boolean {
  const batch = batches().get(id);
  if (!batch || batch.finishedAt) return false;
  // Only stops work not yet started. A request already in flight has been billed
  // whatever it is going to be billed, and throwing its audio away would mean paying
  // for it twice.
  batch.stopping = true;
  batch.stoppedBecause = "stopped";
  return true;
}

//------------------------------------------------------------------------------
// Quoting
//------------------------------------------------------------------------------

export async function quote(lineIds: string[]): Promise<Quote> {
  const [entries, manifest, config] = await Promise.all([
    catalogue(),
    loadManifest(),
    loadConfig().catch(() => null),
  ]);

  const wanted = new Set(lineIds);
  const selected = entries.filter((entry) => wanted.has(entry.id));
  const characters = selected.reduce((n, entry) => n + entry.spoken.length, 0);

  const { creditRate, measuredFrom } = measureRates(manifest, config);

  return {
    lines: selected.length,
    characters,
    credits: creditRate === null ? null : Math.round(characters * creditRate),
    rate: creditRate,
    measuredFrom,
  };
}

//------------------------------------------------------------------------------
// Generating
//------------------------------------------------------------------------------

/** A failure that should abandon the rest of the batch rather than repeat 90 times. */
function isFatal(message: string): boolean {
  return /401|403|quota|unusual activity|missing_permissions/i.test(message);
}

async function regenerateEntry(
  entry: CatalogueEntry,
  config: VoiceConfig,
  key: string,
  onRateLimit: () => void,
): Promise<{ version: number; credits: number | null }> {
  const { audio, credits } = await synthesize(entry.spoken, config, key, { onRateLimit });

  // Archives the take being replaced. This is what makes a bad re-roll reversible,
  // and the reason writeAudio lives in store.mjs rather than in the caller.
  const path = await writeAudio(entry.file, audio);

  const version = await insertTake(
    entry.id,
    {
      file: entry.file,
      textHash: entry.hash,
      chars: entry.spoken.length,
      credits,
      durationSec: await durationOf(path),
      bytes: (await stat(path)).size,
      voiceId: config.voiceId ?? null,
      modelId: config.modelId,
      outputFormat: config.outputFormat,
      dictionaryId: config.dictionaryId ?? null,
      dictionaryVersionId: config.dictionaryVersionId ?? null,
      generatedAt: new Date().toISOString(),
    },
    "generated",
    // Unlike an imported take, this one knows exactly what it was made with, so a
    // version that sounds right can be reproduced after config.json has moved on.
    config.voiceSettings,
  );

  return { version, credits };
}

// The addon resolves every clip through Sounds.lua, so a new take that is not in it is
// unreachable, and a stale duration resets the Play button at the wrong moment. Run
// once per batch rather than per line: it rewrites the whole 1353-row table.
async function publish() {
  await exportManifest();
  await buildLookup();
}

/** One line, awaited. One click, cheap, and the archive makes it reversible. */
export async function regenerateOne(lineId: string): Promise<Job> {
  const entries = await catalogue();
  const entry = entries.find((candidate) => candidate.id === lineId);
  if (!entry) throw new Error(`unknown lineId ${lineId}`);

  const config = await loadConfig();
  const key = await apiKey();
  await resolveVoiceId(config, key);
  await resolveDictionary(config, key);

  const job: Job = {
    lineId,
    name: entry.name || entry.key || entry.zoneName,
    zoneName: entry.zoneName,
    chars: entry.spoken.length,
    state: "running",
  };

  try {
    const { version, credits } = await regenerateEntry(entry, config, key, () => {});
    await publish();
    return { ...job, state: "done", version, credits };
  } catch (err) {
    return { ...job, state: "failed", error: (err as Error).message };
  }
}

/**
 * A selection, in the background. Returns the batch id immediately; the caller polls.
 *
 * Concurrency comes from the account's plan, exactly as the CLI derives it, and a 429
 * halves it for a minute rather than retrying into a wall.
 */
export async function startBatch(lineIds: string[]): Promise<Batch> {
  const entries = await catalogue();
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const selected = lineIds
    .map((id) => byId.get(id))
    .filter((entry): entry is CatalogueEntry => entry !== undefined);

  if (selected.length === 0) throw new Error("nothing to regenerate");

  const batch: Batch = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    finishedAt: null,
    stoppedBecause: null,
    stopping: false,
    jobs: selected.map((entry) => ({
      lineId: entry.id,
      name: entry.name || entry.key || entry.zoneName,
      zoneName: entry.zoneName,
      chars: entry.spoken.length,
      state: "pending" as JobState,
    })),
  };

  batches().set(batch.id, batch);

  // Deliberately not awaited: the response carries the id and the client polls. The
  // work outliving the request is the point -- closing the tab must not strand it.
  void run(batch, selected);

  return batch;
}

async function run(batch: Batch, selected: CatalogueEntry[]) {
  const jobs = new Map(batch.jobs.map((job) => [job.lineId, job]));

  try {
    const config = await loadConfig();
    const key = await apiKey();
    await resolveVoiceId(config, key);
    await resolveDictionary(config, key);

    const tier = await fetchTier(key);
    const budget = budgetFor(tier, config.modelId);
    const limiter = new Limiter(budget);

    let rateLimitedAt: number | null = null;
    const onRateLimit = () => {
      rateLimitedAt = Date.now();
      limiter.setLimit(afterRateLimit(budget, rateLimitedAt, Date.now()));
      setTimeout(() => {
        if (rateLimitedAt !== null && Date.now() - rateLimitedAt >= COOL_DOWN_MS) {
          limiter.setLimit(budget);
        }
      }, COOL_DOWN_MS + 100);
    };

    await Promise.all(
      selected.map((entry) =>
        limiter.run(async () => {
          const job = jobs.get(entry.id)!;
          if (batch.stopping) {
            // Left pending rather than marked failed: nothing was attempted and
            // nothing was billed, and "failed" would suggest otherwise.
            return;
          }

          job.state = "running";
          try {
            const { version, credits } = await regenerateEntry(entry, config, key, onRateLimit);
            job.state = "done";
            job.version = version;
            job.credits = credits;
          } catch (err) {
            const message = (err as Error).message;
            job.state = "failed";
            job.error = message;
            if (isFatal(message)) {
              batch.stopping = true;
              batch.stoppedBecause = message;
            }
          }
        }),
      ),
    );

    // Even a partly failed batch publishes: the lines that did succeed have been paid
    // for, and leaving them out of the lookup would make them unreachable in-game.
    if (batch.jobs.some((job) => job.state === "done")) await publish();
  } catch (err) {
    batch.stoppedBecause = (err as Error).message;
  } finally {
    batch.finishedAt = Date.now();
  }
}

//------------------------------------------------------------------------------
// Restoring
//------------------------------------------------------------------------------

/**
 * Puts an archived take back and makes it live again. No API call, no credits.
 *
 * The restored take becomes a NEW row rather than reviving the old one: quietly
 * re-pointing isCurrent at a superseded row would lose the fact that a restore
 * happened at all, and the archive would no longer line up (see below).
 *
 * ARCHIVE v{n}.mp3 HOLDS TAKE VERSION n's AUDIO. writeAudio moves the live file to
 * the next free archive slot and the caller then inserts the next version, so the two
 * counters stay one apart, permanently. That is what makes it possible to restore a
 * clip's metadata along with its bytes -- and getting this wrong is not cosmetic:
 * carrying the *replaced* take's textHash instead of the *restored* one's leaves a
 * line reading as stale after being restored to audio that matches today's text
 * exactly, which sends you to regenerate something that is already correct.
 */
export async function restore(lineId: string, archiveVersion: number) {
  const entries = await catalogue();
  const entry = entries.find((candidate) => candidate.id === lineId);
  if (!entry) throw new Error(`unknown lineId ${lineId}`);

  const rows = await query<{
    textHash: string;
    chars: number;
    voiceId: string | null;
    modelId: string | null;
    outputFormat: string | null;
    dictionaryId: string | null;
    dictionaryVersionId: string | null;
  }>(
    `select "textHash", "chars", "voiceId", "modelId", "outputFormat",
            "dictionaryId", "dictionaryVersionId"
       from "voiceline_take" where "lineId" = $1 and "version" = $2`,
    [lineId, archiveVersion],
  );
  const original = rows[0];
  if (!original) {
    throw new Error(`no take at version ${archiveVersion} for ${lineId}`);
  }

  const path = await restoreTake(entry.file, archiveVersion);

  const version = await insertTake(
    lineId,
    {
      file: entry.file,
      // The restored take's own hash, so staleness describes the audio that is now
      // live rather than the audio it displaced.
      textHash: original.textHash,
      chars: original.chars,
      // Null, not the original cost: this restore was free, and summing credits over
      // takes should total what was actually spent.
      credits: null,
      durationSec: await durationOf(path),
      bytes: (await stat(path)).size,
      voiceId: original.voiceId,
      modelId: original.modelId,
      outputFormat: original.outputFormat,
      dictionaryId: original.dictionaryId,
      dictionaryVersionId: original.dictionaryVersionId,
      generatedAt: new Date().toISOString(),
    },
    "generated",
    null,
  );

  await publish();
  return { lineId, version, restoredFrom: archiveVersion };
}
