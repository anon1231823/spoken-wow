import { NextResponse } from "next/server";

import { requireApiKey, requireRegenerate } from "@/lib/authz";
import { langOfBody } from "@/lib/lang";
import { getBatch, latestBatch, quote, regenerateOne, startBatch, stopBatch } from "@/lib/regenerate";

// THE ONLY ENDPOINT THAT SPENDS MONEY.
//
// Editors and admins only, and that is the whole reason this app has accounts at all: the
// site is public, and without a check here the ElevenLabs bill is too. Guarded on GET as
// well as POST -- the progress of a batch, including which lines failed and why, is not
// something to hand out.
//
// The credits are the caller's own: the key comes from their profile, and there is no
// fallback to the server's. An editor without one is refused with 428 before anything
// reaches ElevenLabs.
//
// lineIds ride in the body, not the path, because they contain colons
// ('s:1411:razor hill').
//
// A single line is awaited and returned inline: it is one click, it is cheap, the
// archive makes it reversible, and a poll cycle for one clip feels broken. Anything
// larger starts a batch and returns its id, because a hundred lines is a minute of
// work that must survive the tab closing.

type Body = { lineIds?: unknown; action?: unknown; batchId?: unknown; lang?: unknown };

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Body;

  if (body.action === "stop") {
    if (typeof body.batchId !== "string") {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }
    return NextResponse.json({ stopped: stopBatch(body.batchId) });
  }

  // Rejected rather than defaulted, for the reason the lore route rejects it: this is
  // the endpoint that spends money, and generating into the wrong language is a bill
  // for audio nobody asked for.
  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }

  const lineIds = body.lineIds;
  if (!Array.isArray(lineIds) || lineIds.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "lineIds must be an array of strings" }, { status: 400 });
  }
  if (lineIds.length === 0) {
    return NextResponse.json({ error: "nothing to regenerate" }, { status: 400 });
  }

  // A quote is not a generation. Asked for separately so the confirmation dialog can
  // show a cost without the act of showing it costing anything.
  if (body.action === "quote") {
    return NextResponse.json(await quote(lineIds as string[], lang));
  }

  // Below this line the request costs money, so it needs the caller's own key. Above
  // it -- quoting and stopping -- costs nothing and must keep working for someone who
  // has not set one up, or the dialog telling them the price would be the thing that
  // refuses them.
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  try {
    if (lineIds.length === 1) {
      const job = await regenerateOne(lineIds[0] as string, key, lang);
      return NextResponse.json({ job }, { status: job.state === "failed" ? 502 : 200 });
    }
    const batch = await startBatch(lineIds as string[], key, lang);
    return NextResponse.json({ batchId: batch.id, queued: batch.jobs.length });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

// Progress. Polled at 1s while a batch runs; there is one process, so there is
// nothing to reconcile and no cursor to keep.
export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const id = new URL(request.url).searchParams.get("batchId");
  const batch = id ? getBatch(id) : latestBatch();
  return NextResponse.json({ batch });
}
