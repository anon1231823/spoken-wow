/**
 * One uploaded clip: play it, or delete it.
 *
 * Range support is not optional even for clips a few megabytes long: Safari opens audio
 * with `Range: bytes=0-1` and refuses a resource that answers 200, so a naive whole-file
 * response works in Chrome and silently fails in Safari. Same reasoning, and the same
 * parseRange, as the take audio.
 */
import fs from "node:fs";

import { parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";
import { denyVoiceRequest } from "@/lib/voices/authz";
import { deleteSample, isStoredSampleName, samplePath } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string; file: string }> };

const CONTENT_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  webm: "audio/webm",
};

export async function GET(request: Request, context: Context) {
  const { voice, file } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;
  if (!isStoredSampleName(file)) return new Response("bad clip name", { status: 400 });

  const target = await samplePath(voice, file);
  let size: number;
  let etag: string;
  try {
    const stat = fs.statSync(target);
    size = stat.size;
    etag = `W/"${size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  } catch {
    return new Response("no such clip", { status: 404 });
  }

  // A clip is immutable once written - the stored name is unique per upload, and an edit
  // means deleting and uploading again - so this can be cached hard. Private, because it is
  // only ever served to an admin.
  const cacheControl = "private, max-age=3600, immutable";

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
  }

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  const extension = file.split(".").pop() ?? "";
  const headers: Record<string, string> = {
    "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": cacheControl,
    ETag: etag,
  };

  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(streamOf(target), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(streamOf(target, range.start, range.end), { status: 206, headers });
}

export async function DELETE(_request: Request, context: Context) {
  const { voice, file } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;
  if (!isStoredSampleName(file)) return Response.json({ error: "bad clip name" }, { status: 400 });

  if (!(await deleteSample(voice, file))) {
    return Response.json({ error: "no such clip" }, { status: 404 });
  }
  return Response.json({ voice, deleted: file });
}
