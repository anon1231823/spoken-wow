/**
 * Join selected clips into one.
 *
 * A static segment, so it takes precedence over [file] and `merge` can never be read as a
 * clip name.
 *
 * Deleting the sources is opt-in here, though the UI ticks it by default: cloning sends
 * every clip in the folder, so originals left beside a merge would be uploaded twice. The
 * API keeps them unless asked, so a caller that has not thought about it does not lose the
 * only copies.
 */
import { denyVoiceRequest } from "@/lib/voices/authz";
import { DEFAULT_PAUSE_SECONDS, mergeSamples, rejectMerge } from "@/lib/voices/merge";
import { deleteSample, isStoredSampleName, listSamples } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;

  let body: { files?: unknown; pauseSeconds?: unknown; deleteSources?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const files = Array.isArray(body.files) ? body.files.filter((f): f is string => typeof f === "string") : [];
  if (!files.every(isStoredSampleName)) {
    return Response.json({ error: "bad clip name" }, { status: 400 });
  }

  const pauseSeconds =
    typeof body.pauseSeconds === "number" ? body.pauseSeconds : DEFAULT_PAUSE_SECONDS;

  const reason = rejectMerge(files, pauseSeconds);
  if (reason) return Response.json({ error: reason }, { status: 400 });

  let merged;
  try {
    merged = await mergeSamples(voice, files, pauseSeconds);
  } catch (error) {
    // ffmpeg's own message is the only clue to a bad input, so it is passed through.
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }

  if (body.deleteSources === true) {
    for (const file of files) await deleteSample(voice, file);
  }

  return Response.json({ voice, merged, samples: await listSamples(voice) }, { status: 201 });
}
