/**
 * The browser's half of regeneration.
 *
 * Deliberately free of node imports: this is loaded into the client bundle, so anything it
 * touches is too. Types are re-declared rather than imported from the server modules for the
 * same reason - importing a type is erased, but importing the module it lives beside is not
 * always, and the production build is the only thing that catches the difference.
 */

import { noApiKeyMessage } from "@/lib/no-api-key";

export type FailureKind =
  | "quota"
  | "auth"
  | "rate-limit"
  | "voice-missing"
  | "bad-request"
  | "upstream";

export type RegenerateOk = {
  ok: true;
  lineId: string;
  file: string;
  version: number;
  bytes: number;
  characters: number;
  /** Exactly what ElevenLabs charged, from its response header. null when it did not say. */
  credits: number | null;
  seed: number | null;
  voice: string;
  spokenText: string;
  sharedWith: number;
  archivedInherited: boolean;
};

export type RegenerateFailed = {
  ok: false;
  kind: FailureKind;
  message: string;
  /** Whether the rest of a batch is worth attempting. */
  fatal: boolean;
};

export type RegenerateResponse = RegenerateOk | RegenerateFailed;

export type GenerationStatusResponse = {
  voices: string[];
  subscription: {
    tier: string;
    characterCount: number;
    characterLimit: number;
    resetAt: string | null;
  } | null;
  error: string | null;
  /**
   * Whether the signed-in user has no ElevenLabs key on file.
   *
   * Distinct from `error`, which is ElevenLabs refusing a key that exists. This one is the
   * state every new collaborator starts in, and the fix is one page away rather than a
   * support question - so the explorer names it instead of showing an upstream message.
   */
  noApiKey: boolean;
  settings: {
    modelId: string;
    voiceSettings: Record<string, number | boolean>;
    seedStrategy: string;
  };
  settingsSource: "file" | "database";
  /**
   * Credits per character, calibrated from what this account has actually been charged.
   *
   * `samples: 0` means nothing has been generated with this model yet and the list rate is
   * standing in - an upper bound, not a measurement.
   */
  rate: { rate: number; samples: number; modelId: string | null };
};

export async function fetchGenerationStatus(
  signal?: AbortSignal,
): Promise<GenerationStatusResponse | null> {
  try {
    const response = await fetch("/api/generation/status", { signal });
    if (!response.ok) return null;
    return (await response.json()) as GenerationStatusResponse;
  } catch {
    // The page works without it: the balance goes unshown and no button is pre-disabled.
    return null;
  }
}

/**
 * How many takes each of these files has, and which of them are of text that has since moved.
 *
 * POST rather than GET because a search can name a few thousand files, and a query string
 * long enough to carry them would be refused before it arrived. Both answers in one trip
 * because it is the same page asking about the same files.
 */
export type TakeInfo = { counts: Record<string, number>; stale: string[] };

export async function fetchTakeCounts(
  files: string[],
  signal?: AbortSignal,
): Promise<TakeInfo | null> {
  try {
    const response = await fetch("/api/lines/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }),
      signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as TakeInfo;
  } catch {
    // The page works without it: no line offers history, nothing is marked stale, and
    // nothing else changes.
    return null;
  }
}

/** One unit of work in a batch. Mirrors BatchLine in lib/search.ts; see the note above. */
export type BatchJob = {
  lineId: string;
  audioPath: string;
  npcName: string;
  voice: string;
  characters: number;
  preview: string;
};

/**
 * Every job a set of filters would regenerate.
 *
 * The whole match set, not the page on screen: the confirmation dialog exists to say what
 * "regenerate all of this" costs, and a figure for the visible fifty would be a lie.
 */
export async function fetchBatchJobs(
  params: URLSearchParams,
  signal?: AbortSignal,
): Promise<BatchJob[] | null> {
  try {
    const response = await fetch(`/api/search/lines?${params}`, { signal });
    if (!response.ok) return null;
    return ((await response.json()) as { jobs: BatchJob[] }).jobs;
  } catch {
    return null;
  }
}

export async function regenerate(
  lineId: string,
  signal?: AbortSignal,
): Promise<RegenerateResponse> {
  let response: Response;
  try {
    response = await fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineId }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, kind: "upstream", message: message(error), fatal: false };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    // A missing key is an auth failure, and fatal for the same reason a bad one is: every
    // remaining line in the batch would be refused by the same guard.
    const noKey = noApiKeyMessage(response.status, body as { error?: string; code?: string });
    if (noKey) return { ok: false, kind: "auth", message: noKey, fatal: true };

    return {
      ok: false,
      kind: (body.kind as FailureKind) ?? "upstream",
      message: (body.error as string) ?? `request failed (${response.status})`,
      // Defaults to stopping: an unrecognised failure repeated ninety more times is worse
      // than a batch that stops early and can be restarted.
      fatal: body.fatal !== false,
    };
  }

  return body as unknown as RegenerateOk;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The queue as the panel needs it. Mirrors QueueSnapshot in lib/generation/queue.ts.
 *
 * Re-declared rather than imported for the reason this file's header gives: that module
 * imports `pg`, and pulling it into the client graph fails only the production build.
 */
export type QueueSnapshot = {
  active: boolean;
  counts: Record<"pending" | "running" | "done" | "failed" | "cancelled", number>;
  credits: number;
  unpriced: number;
  running: { lineId: string; npcName: string; preview: string }[];
  failures: { lineId: string; message: string }[];
  latestBatch: { cancelled: number; stoppedBecause: string | null } | null;
  finished: { id: string; lineId: string; file: string; version: number }[];
  cursor: string;
};

export type QueuedBatch = { batchId: string; queued: number; skipped: number };

/**
 * Start a batch, or say why not.
 *
 * A string rather than null for the refusals that have something to tell the operator -
 * having no ElevenLabs key is the one that a new collaborator meets first, and "Could not
 * queue the batch" would send them looking in the wrong place.
 */
export async function queueBatch(
  filters: URLSearchParams,
  label: string,
): Promise<QueuedBatch | { error: string } | null> {
  try {
    const response = await fetch("/api/regenerate/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filters: filters.toString(), label }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const noKey = noApiKeyMessage(response.status, body as { error?: string; code?: string });
      return noKey ? { error: noKey } : null;
    }
    return body as unknown as QueuedBatch;
  } catch {
    return null;
  }
}

export async function fetchQueue(
  since: string | null,
  signal?: AbortSignal,
): Promise<QueueSnapshot | null> {
  try {
    const params = since ? `?since=${encodeURIComponent(since)}` : "";
    const response = await fetch(`/api/regenerate/queue${params}`, { signal });
    if (!response.ok) return null;
    return (await response.json()) as QueueSnapshot;
  } catch {
    // A dropped poll is not an error worth showing: the next one is two seconds away and
    // the cursor has not moved, so nothing is missed.
    return null;
  }
}

/** Wave away finished work up to `through`, the cursor the panel was showing. */
export async function dismissQueue(through: string): Promise<void> {
  await fetch("/api/regenerate/queue/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ through }),
  }).catch(() => {});
}

export async function stopQueue(): Promise<void> {
  await fetch("/api/regenerate/queue/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
}
