/**
 * Playing an archived take, in whichever section owns it:
 * /api/takes/audio?source=zones&file=1411/razor-hill&version=2
 *
 * The point of a history is hearing the alternative before committing to it, so this is
 * what makes "restore" a decision rather than a gamble. Quests had it and the other two did
 * not, which is half the reason their history was never worth showing.
 *
 * Query parameters rather than path segments, because the three sections name files by
 * different frozen rules and two of them are nested paths: reassembling one out of segments
 * is how a traversal bug gets written. The file is whitelisted against the section's own
 * addressable set either way, and the archived name is resolved from the take rather than
 * taken from the caller -- there is no string here that a request can steer at another
 * directory.
 *
 * Deliberately simpler than the live audio routes. A take never changes once written -- a
 * new take gets a new number, and nothing renames or deletes one -- so it is cached
 * immutably with no ETag dance. That holds for the live take too: restoring an earlier one
 * moves the flag to a different version, which is a different URL. Range support is kept because Safari opens audio
 * with `bytes=0-1` and refuses a 200.
 *
 * Collaborator-only, unlike the live audio: a signed-out visitor has no business
 * enumerating takes that were rejected.
 */
import fs from "node:fs";
import { NextRequest } from "next/server";

import { requireRegenerate } from "@/lib/generation/authz";
import { parseRange } from "@/lib/range";
import { isSource } from "@/lib/reports/reports";
import { streamOf } from "@/lib/stream";
import { isAddressableFile } from "@/lib/takes/files";
import { takePath } from "@/lib/takes/store";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const params = request.nextUrl.searchParams;
  const source = params.get("source");
  const file = params.get("file");
  const version = Number(params.get("version"));

  if (!isSource(source) || !file || !Number.isInteger(version) || version < 0) {
    return new Response("bad take", { status: 400 });
  }
  if (!(await isAddressableFile(source, file))) {
    return new Response("unknown file", { status: 404 });
  }

  // The take was never recorded. Distinct from the 404 below, which is a take that exists
  // and whose bytes do not -- the panel no longer predicts either, so this is where a
  // listener finds out.
  const target = await takePath(source, file, version);
  if (!target) return new Response("no such take", { status: 404 });

  let size: number;
  try {
    size = fs.statSync(target).size;
  } catch {
    return new Response("no such take", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    // Immutable is honest here: one version of a file is written once and never rewritten.
    "Cache-Control": "public, max-age=31536000, immutable",
  };

  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  if (!range) {
    headers["Content-Length"] = String(size);
    return new Response(streamOf(target), { status: 200, headers });
  }

  headers["Content-Length"] = String(range.end - range.start + 1);
  headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(streamOf(target, range.start, range.end), { status: 206, headers });
}
