/**
 * Filing a report.
 *
 * POST IS THE ONLY UNAUTHENTICATED WRITE IN THIS APP. Anyone on the internet can reach it,
 * because the person best placed to report a bad line is a player who has just heard one and
 * has no account here. Every defence below exists because of that, and any verb added to this
 * path inherits the exposure - put it in a sibling route instead, as /resolve is.
 *
 * A report never becomes a regeneration job. Regenerating spends ElevenLabs credits, so a
 * public write that could start one would be a public write that spends money. A collaborator
 * reads the report and queues the file through the existing flow.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/reports/client-ip";
import { validateSubmission } from "@/lib/reports/reports";
import { countRecent, createReport } from "@/lib/reports/store";
import { formatTarget, parseTarget, resolveTarget } from "@/lib/reports/target";

export const dynamic = "force-dynamic";

/** Deliberately not configurable: a knob nobody turns is a knob set wrong. */
const PER_HOUR = 10;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // A hidden field a human never fills. 200 and not 400: an error response teaches the script
  // to stop sending the field, and a bot that believes it succeeded stops adapting.
  if (typeof body.website === "string" && body.website.trim()) {
    return Response.json({ ok: true });
  }

  const target = typeof body.target === "string" ? parseTarget(body.target.split("/")) : null;
  if (!target) {
    return Response.json({ error: "unknown target" }, { status: 400 });
  }

  const validated = validateSubmission(body);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }

  const ip = clientIp(request);
  if ((await countRecent(ip, WINDOW_MS)) >= PER_HOUR) {
    return Response.json({ error: "too many reports" }, { status: 429 });
  }

  // A signed-in reporter's identity comes from the session, and any name or email in the body
  // is dropped rather than merged: letting someone sign in and then type a different name is a
  // way to put words in another person's mouth.
  const session = await auth.api.getSession({ headers: await headers() });

  // Only a lineId the address actually resolves to is stored, so the browser cannot attach a
  // report to a line the reporter never saw.
  const claimed = typeof body.lineId === "string" ? body.lineId : null;
  const lineId = resolveTarget(target).find((line) => line.lineId === claimed)?.lineId ?? null;

  await createReport({
    // The quests corpus, because this route is reached from the quests report page and the
    // addresses it validates are quest and NPC ones. The zones side files through the same
    // table with its own source.
    source: "quests",
    lineId,
    target: formatTarget(target),
    category: validated.value.category,
    body: validated.value.body,
    userId: session?.user.id ?? null,
    name: session ? null : validated.value.name,
    email: session ? null : validated.value.email,
    ip,
  });

  return Response.json({ ok: true });
}
