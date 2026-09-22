/**
 * Answering a request for one take's audio: the live one of a line, or any earlier one.
 *
 * Written once for the four audio routes. They used to stat a store file each, with their
 * own Range and ETag code; now every take is a file in the archive found through its row
 * (store.ts), so what is left to differ between them is how a URL names the file and
 * whether the answer can be cached for good.
 *
 * Range is answered here because Safari opens audio with `bytes=0-1` and refuses a
 * resource that answers 200, and without it the scrubber cannot seek.
 */
import "server-only";

import { stat } from "node:fs/promises";
import path from "node:path";

import { parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";

import { BASE_LANG, langTag, type Lang } from "@/lib/lang";

import type { TakeBytes } from "./store";

/**
 * `immutable` for a URL naming one version, which never changes. A line's live URL names
 * whichever take is live, so it is revalidated: the ETag is the archived file's name, which
 * carries the version and a hash of the bytes, and moves exactly when the live take does.
 */
export async function serveTake(
  request: Request,
  bytes: TakeBytes,
  { immutable, lang = BASE_LANG }: { immutable: boolean; lang?: Lang },
): Promise<Response> {
  // Three different 404s, because the page predicts none of them and this is where a
  // listener finds out: nothing recorded, a take whose clip was not kept, and a take whose
  // named file is missing from this machine.
  if (bytes.kind === "none") return new Response("no audio for this line", { status: 404 });
  if (bytes.kind === "gone") return new Response("this take's audio was not kept", { status: 404 });

  const info = await stat(bytes.path).catch(() => null);
  if (!info) return new Response("this take's audio is not on disk", { status: 404 });

  const cacheControl = immutable
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300, must-revalidate";
  // The archived name is unique within one language's directory. Another language's take
  // of the same file can carry the same version and, in principle, the same short hash, so
  // its tag says which language it is; English keeps the tags browsers already hold.
  const archived = path.basename(bytes.path, ".mp3");
  const etag = lang === BASE_LANG ? `"${archived}"` : `"${lang}-${archived}"`;

  if (!immutable && request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": cacheControl } });
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
  if (lang !== BASE_LANG) headers["Content-Language"] = langTag(lang);

  if (!range) {
    headers["Content-Length"] = String(info.size);
    return new Response(streamOf(bytes.path), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
  return new Response(streamOf(bytes.path, range.start, range.end), { status: 206, headers });
}
