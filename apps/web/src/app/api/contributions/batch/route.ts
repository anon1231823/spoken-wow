/**
 * Many contributions at once: what a player's background gathering collected, uploaded as
 * the saved variables file the game wrote (the page pulls the envelopes out of it first --
 * lib/contributions/saved-variables.ts -- so only they are sent).
 *
 * A sibling of ../route.ts rather than a mode of it, as that file asks of any new verb on this
 * unauthenticated path. Every envelope is checked exactly as a single one is -- parseEnvelope,
 * then submissionFrom -- and one that fails is counted and skipped rather than failing the
 * rest: a file gathered over an evening should not be refused whole for one bad line.
 *
 * Places are refused here. A zones contribution is the description the player writes on the
 * page, and a file has none; the addon never gathers them, so one arriving is a hand-built file.
 */
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { clientIp } from "@/lib/reports/client-ip";
import { parseEnvelope } from "@/lib/contributions/envelope";
import {
  CONTRIBUTION_WINDOW_MS,
  CONTRIBUTIONS_PER_HOUR,
  storeSubmission,
  stringOrNull,
} from "@/lib/contributions/intake";
import { MAX_ENVELOPES } from "@/lib/contributions/saved-variables";
import { countRecentContributions, recordContributionHit } from "@/lib/contributions/store";
import { submissionFrom } from "@/lib/contributions/submission";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  // 200 and not 400, as on the single route: a bot that believes it succeeded stops adapting.
  if (typeof body.website === "string" && body.website.trim()) {
    return Response.json({ ok: true, accepted: 0, refused: {} });
  }

  const envelopes = body.envelopes;
  if (!Array.isArray(envelopes) || envelopes.length === 0) {
    return Response.json({ error: "missing" }, { status: 400 });
  }
  if (envelopes.length > MAX_ENVELOPES) {
    return Response.json({ error: "too many" }, { status: 413 });
  }

  const ip = clientIp(request);
  // One hit per upload against the single route's allowance -- see intake.ts.
  const [recent, session] = await Promise.all([
    countRecentContributions(ip, CONTRIBUTION_WINDOW_MS),
    auth.api.getSession({ headers: await headers() }),
  ]);
  if (recent >= CONTRIBUTIONS_PER_HOUR) {
    return Response.json({ error: "too many contributions" }, { status: 429 });
  }

  const identity = {
    body: null,
    userId: session?.user.id ?? null,
    name: session ? null : stringOrNull(body.name, 200),
    email: session ? null : stringOrNull(body.email, 320),
    ip,
  };

  let accepted = 0;
  const refused: Record<string, number> = {};
  const refuse = (reason: string) => {
    refused[reason] = (refused[reason] ?? 0) + 1;
  };
  const resolved = new Set<string>();

  for (const raw of envelopes) {
    if (typeof raw !== "string") {
      refuse("malformed");
      continue;
    }
    // parseEnvelope refuses an oversized one itself; the single route measures first only
    // because it answers that case with its own status code.
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      refuse(parsed.error);
      continue;
    }
    if (parsed.value.source === "zones") {
      refuse("describe");
      continue;
    }
    const submission = submissionFrom(parsed.value, raw, null);
    if (!submission) {
      refuse("incomplete");
      continue;
    }
    await storeSubmission(submission, identity, resolved);
    accepted += 1;
  }

  await recordContributionHit(ip);

  return Response.json({ ok: true, accepted, refused });
}
