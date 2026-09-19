/**
 * Serves a zone clip, with Range support because that is what <audio> seeking requires --
 * without it the browser can only play from the start and the scrubber does nothing.
 *
 * The same shape as the quests audio route, sharing its Range parser: the quests one had
 * already grown the suffix form (`bytes=-1024`) that this side's inline parser did not
 * handle, and one of them being right is worse than both being the same.
 *
 * What differs is the guard. Quests paths are checked against a shape; these are checked
 * for membership in the set of paths the catalogue can address, which is traversal-proof by
 * construction: a path either names a file some line owns or it does not exist, and no
 * amount of "../" produces a member of that set.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";
import { isAddressable, soundsDir } from "@/lib/zones/audio";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const rel = (await context.params).path.join("/");

  if (!(await isAddressable(rel))) {
    return new Response("bad audio path", { status: 400 });
  }

  const file = join(soundsDir(), rel);
  const info = await stat(file).catch(() => null);
  if (!info) {
    // A gap, not an error: the explorer already knows which lines have no audio and
    // renders that state itself.
    return new Response("no audio for this line", { status: 404 });
  }

  // Weak, because two syntheses of one line are never byte-identical but size and mtime
  // both move whenever the store does.
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  // Explicitly not immutable: a regenerated clip reuses its filename, so a cached copy has
  // to be revalidated or the browser would keep playing the take that was replaced.
  const cacheControl = "public, max-age=300, must-revalidate";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const range = parseRange(request.headers.get("range"), info.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${info.size}`, "Accept-Ranges": "bytes" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  if (!range) {
    headers["Content-Length"] = String(info.size);
    return new Response(streamOf(file), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
  return new Response(streamOf(file, range.start, range.end), { status: 206, headers });
}
