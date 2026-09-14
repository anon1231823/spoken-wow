/**
 * Playing an archived take: /api/quests/audio-history/quests/5-accept/1.mp3
 *
 * The point of history is being able to hear the alternative before committing to it, so
 * this exists to make "restore" a decision rather than a gamble.
 *
 * Deliberately simpler than /api/quests/audio. An archived take never changes once written - a new
 * take gets a new number - so it can be cached immutably, and there is no ETag dance to do.
 * Range support is kept because Safari opens audio with `bytes=0-1` and refuses a 200,
 * exactly as it does for the store.
 *
 * Collaborator-only, unlike /api/quests/audio: a signed-out visitor has no business enumerating
 * takes that were rejected.
 */
import fs from "node:fs";
import { NextRequest } from "next/server";

import { corpusFiles } from "@/lib/audio";
import { versionPath } from "@/lib/generation/archive";
import { requireRegenerate } from "@/lib/generation/authz";
import { parseRange } from "@/lib/range";
import { streamOf } from "@/lib/stream";

export const dynamic = "force-dynamic";

/**
 * Turn ["quests", "5-accept", "1.mp3"] into a store path and a version.
 *
 * Traversal-proof by construction rather than by sanitisation: the reassembled store path
 * has to be a member of the corpus's own set of files, and no arrangement of `..` produces
 * one. Same reasoning as isVoiceSlot.
 */
function parsePath(segments: string[]): { file: string; version: number } | null {
  if (segments.length !== 3) return null;
  const [sub, name, leaf] = segments;

  const match = /^(\d+)\.mp3$/.exec(leaf);
  if (!match) return null;

  const file = `${sub}/${name}.mp3`;
  if (!corpusFiles().has(file)) return null;

  return { file, version: Number(match[1]) };
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const parsed = parsePath((await context.params).path);
  if (!parsed) return new Response("bad history path", { status: 400 });

  const target = versionPath(parsed.file, parsed.version);
  let size: number;
  try {
    size = fs.statSync(target).size;
  } catch {
    // Pruned, or removed by hand. The history panel already marks these unplayable.
    return new Response("no such take", { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Accept-Ranges": "bytes",
    // Immutable is honest here: version 1 of a file is written once and never rewritten.
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
