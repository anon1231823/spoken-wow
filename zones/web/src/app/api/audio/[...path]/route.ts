import { stat } from "node:fs/promises";
import { join } from "node:path";

import { isAddressable, soundsDir } from "@/lib/audio";
import { langFromParams } from "@/lib/lang";
import { streamOf } from "@/lib/stream";

// Serves a clip, with Range support because that is what <audio> seeking requires --
// without it the browser can only play from the start, and the scrubber does nothing.

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const rel = (await params).path.join("/");
  // A query parameter rather than a path segment: `file` is language-free by design,
  // so every language addresses the same paths, and links already handed out keep
  // resolving to English.
  const lang = langFromParams(new URL(request.url).searchParams);

  // Membership in a set derived from the catalogue, not string inspection. See
  // addressableFiles() in lib/audio.ts.
  if (!(await isAddressable(rel, lang))) {
    return new Response("bad audio path", { status: 400 });
  }

  const file = join(soundsDir(lang), rel);
  const info = await stat(file).catch(() => null);
  if (!info) {
    // A gap, not an error: the explorer already knows which lines have no audio and
    // renders that state itself.
    return new Response("no audio for this line", { status: 404 });
  }

  // Weak, because two syntheses of one line are never byte-identical but size and
  // mtime both move whenever the store does.
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  // Explicitly not immutable: a regenerated clip reuses its filename, so a cached
  // copy has to be revalidated or the browser would keep playing the old take.
  const cacheControl = "public, max-age=300, must-revalidate";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (match) {
      const start = match[1] === "" ? 0 : Number(match[1]);
      const end = match[2] === "" ? info.size - 1 : Math.min(Number(match[2]), info.size - 1);

      if (start >= info.size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${info.size}` },
        });
      }

      return new Response(streamOf(file, start, end), {
        status: 206,
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${info.size}`,
          "Accept-Ranges": "bytes",
          ETag: etag,
          "Cache-Control": cacheControl,
        },
      });
    }
  }

  return new Response(streamOf(file), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(info.size),
      "Accept-Ranges": "bytes",
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
