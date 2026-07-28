import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

import { AUDIO_DIR } from "@/lib/paths";
import { isSafeAudioPath, parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const rel = (await context.params).path.join("/");
  if (!isSafeAudioPath(rel)) {
    return new Response("bad audio path", { status: 400 });
  }

  const file = path.join(AUDIO_DIR, rel);
  let size: number;
  let etag: string;
  try {
    const stat = fs.statSync(file);
    size = stat.size;
    // Weak, because two syntheses of the same line are not byte-identical but mtime+size
    // changes whenever the store does. Enough to make a replay a 304 instead of 1.1 MB.
    etag = `W/"${size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  } catch {
    // A gap, not an error: the UI already knows which lines have no audio.
    return new Response("no audio for this line", { status: 404 });
  }

  // Not immutable: gossip filenames are md5(text+race+gender), but quest names like
  // 5-accept.mp3 are reused when a line is regenerated, so a permanent cache would pin
  // stale audio. A short max-age plus revalidation gets the wins without the trap.
  const cacheControl = "public, max-age=300, must-revalidate";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(streamOf(file), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(streamOf(file, range.start, range.end), { status: 206, headers });
}
