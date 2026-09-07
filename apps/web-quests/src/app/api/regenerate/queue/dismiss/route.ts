/**
 * Wave away the finished work the panel is still reporting.
 *
 * The X used to set React state, which meant a run stayed dismissed until the next reload and
 * then came back - with its credit total - on every navigation. Dismissal belongs on the
 * server for the same reason the panel does: it is a statement about the queue, not about one
 * tab's opinion of it.
 *
 * It never touches pending or running work. Stopping a queue is /stop's job, and a button
 * labelled with a cross must not be able to cancel anything.
 */
import { NextRequest, NextResponse } from "next/server";

import { requireRegenerate } from "@/lib/generation/authz";
import { dismissThrough } from "@/lib/generation/queue";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { through?: unknown };
  // The panel sends the cursor it was showing, so a job that finished between the render and
  // the click stays news rather than being dismissed unseen.
  const through = typeof body.through === "string" ? body.through : null;
  if (!through || !/^\d+$/.test(through)) {
    return NextResponse.json({ error: "through is required" }, { status: 400 });
  }

  await dismissThrough(through, session.user.id);
  return NextResponse.json({ ok: true });
}
