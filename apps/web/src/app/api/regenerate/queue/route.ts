/**
 * The regeneration queue: adding to it, and watching it.
 *
 * POST takes the *filters*, not a list of jobs. The job set is re-derived here with the same
 * query /api/search/lines runs, so queueing forty thousand lines is a small request and the
 * server decides what is in the batch - a client that sent the list could send a different
 * one from the one it was quoted for.
 *
 * GET is the whole queue rather than one batch. There is one ElevenLabs account and one
 * budget, so a batch someone else started is spending the same money and belongs on screen.
 */
import { NextRequest, NextResponse } from "next/server";

import { storeIndex } from "@/lib/audio";
import { loadCorpus } from "@/lib/corpus";
import { requireApiKey, requireRegenerate } from "@/lib/generation/authz";
import { createBatch, enqueue, snapshot } from "@/lib/generation/queue";
import { searchContext } from "@/lib/issues/context";
import { batchJobs, matchingLines } from "@/lib/search";
import { filtersFromParams, needsDates, needsStale } from "@/lib/search-request";
import { ensureQueueRunning, queueWorker } from "@/lib/generation/boot";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  // Checked at enqueue rather than only in the worker. Every job in the batch is generated
  // with the key of whoever started it, so a batch queued without one is forty thousand rows
  // that can only fail - and the person who pressed the button is no longer here to be told.
  const { denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  // Nothing starts the queue on boot - see lib/generation/boot.ts for why - so every route
  // that touches it wakes it first. After the first call this is a property read.
  ensureQueueRunning();

  const body = (await request.json().catch(() => ({}))) as {
    filters?: unknown;
    label?: unknown;
  };
  if (typeof body.filters !== "string") {
    return NextResponse.json(
      { error: "filters is required, as a query string", kind: "bad-request" },
      { status: 400 },
    );
  }

  const filters = filtersFromParams(new URLSearchParams(body.filters));
  const context = await searchContext(filters.finding, needsDates(filters), needsStale(filters));
  const lines = matchingLines(loadCorpus(), storeIndex(), filters, context);
  // The same overrides the estimate was built from, so what is queued is what was quoted.
  const jobs = batchJobs(lines, context.overrides);

  if (jobs.length === 0) {
    return NextResponse.json({ error: "nothing to regenerate", kind: "bad-request" }, { status: 400 });
  }

  const label = typeof body.label === "string" && body.label ? body.label : "a search";
  const batchId = await createBatch(label, session.user.id);
  const { queued, skipped } = await enqueue(batchId, jobs);

  // The loop is on a two-second idle tick, and waiting that out before the first take would
  // be the most visible part of pressing the button.
  queueWorker()?.nudge();

  return NextResponse.json({ batchId, queued, skipped });
}

export async function GET(request: NextRequest) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  // The poll is what resumes a batch after a deploy: Explorer calls this every fifteen
  // seconds for anyone who can regenerate, so an admin with the page open is the wake-up.
  ensureQueueRunning();

  const rawSince = request.nextUrl.searchParams.get("since");
  // snapshot() hands its cursor straight to `coalesce($1::bigint, 0)`, so anything that is
  // not digits belongs to the route, not the store: Postgres would otherwise throw and turn
  // a bad query param into an opaque 500 instead of a 400.
  if (rawSince !== null && !/^\d+$/.test(rawSince)) {
    return NextResponse.json(
      { error: "since must be a cursor from a previous snapshot", kind: "bad-request" },
      { status: 400 },
    );
  }

  return NextResponse.json(await snapshot(rawSince));
}
