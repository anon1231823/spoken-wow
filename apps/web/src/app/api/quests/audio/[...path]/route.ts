/**
 * A quests line's live take: /api/quests/audio/gossip/31ab….mp3.
 *
 * The path is the one the addon resolves, so a URL stays meaningful across regenerations;
 * which take it plays is the row's `isCurrent`, and the bytes are that take's archived
 * file. Checked against a whitelist shape rather than sanitised.
 */
import { NextRequest } from "next/server";

import { isSafeAudioPath } from "@/lib/range";
import { serveTake } from "@/lib/takes/serve";
import { livePath } from "@/lib/takes/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const file = (await context.params).path.join("/");
  if (!isSafeAudioPath(file)) return new Response("bad audio path", { status: 400 });
  return serveTake(request, await livePath("quests", file), { immutable: false });
}
