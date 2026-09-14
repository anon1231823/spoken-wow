/**
 * Seed a voice's clips from the game's own barks.
 *
 * A static segment like `merge`, so it takes precedence over [file] and can never be read as
 * a clip name.
 *
 * The clips are copied server-side from voice/npc-lines rather than uploaded, then joined
 * into one file straight away. Two reasons for merging here rather than leaving it to a
 * second call: a flavor has up to 27 clips, well past the 25 an upload may carry, and a
 * clone reads whatever is in the folder - so the steady state has to be the one merged file
 * that cloning actually wants.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { denyVoiceRequest } from "@/lib/voices/authz";
import { DEFAULT_PAUSE_SECONDS, mergeSamples } from "@/lib/voices/merge";
import { npcLineClips } from "@/lib/voices/npcLines";
import { deleteSample, listSamples, storeSample } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;

  let replace = false;
  try {
    const body = await request.json();
    replace = body?.replace === true;
  } catch {
    // A bare POST means "seed it if it is empty", which is the safe default.
  }

  const existing = await listSamples(voice);
  if (existing.length > 0 && !replace) {
    return Response.json(
      { error: `${voice} already has ${existing.length} clips; pass replace to overwrite` },
      { status: 409 },
    );
  }

  const clips = await npcLineClips(voice);
  if (clips.length === 0) {
    return Response.json(
      { error: `no game clips for ${voice} in voice/npc-lines` },
      { status: 404 },
    );
  }

  // Clear first, so replacing cannot leave the old merge behind to be cloned alongside the
  // new one.
  for (const sample of existing) await deleteSample(voice, sample.file);

  const stored = [];
  for (const clip of clips) {
    stored.push(await storeSample(voice, path.basename(clip), await fs.readFile(clip)));
  }

  // A lone clip is already what a merge of it would be, and the filter graph has no
  // meaningful shape with nothing to join.
  let merged = stored.length === 1 ? stored[0] : null;
  if (!merged) {
    try {
      merged = await mergeSamples(
        voice,
        stored.map((s) => s.file),
        DEFAULT_PAUSE_SECONDS,
      );
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 },
      );
    }
    for (const sample of stored) await deleteSample(voice, sample.file);
  }

  return Response.json(
    { voice, imported: stored.length, merged, samples: await listSamples(voice) },
    { status: 201 },
  );
}
