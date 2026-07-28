/**
 * The clips for one voice: list them, add more.
 *
 * Uploads are buffered through request.formData() rather than streamed. A clip is capped at
 * 25 MiB and this is an admin-only tool with one operator, so the simpler code is worth more
 * than the memory it costs.
 *
 * Note nginx's client_max_body_size defaults to 1 MiB, which would reject every real clip
 * before it reached here — see deploy/nginx-voiceover.conf.
 */
import { denyVoiceRequest } from "@/lib/voices/authz";
import { listSamples, rejectUpload, storeSample } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function GET(_request: Request, context: Context) {
  const { voice } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;

  return Response.json({ voice, samples: await listSamples(voice) });
}

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Also what a body larger than the proxy allows looks like from here.
    return Response.json({ error: "could not read the upload" }, { status: 400 });
  }

  const incoming = form.getAll("files").filter((value): value is File => value instanceof File);

  // Validated as a batch before anything is written, so a rejected upload leaves no
  // half-applied state to clean up.
  const reason = rejectUpload(incoming, await listSamples(voice));
  if (reason) return Response.json({ error: reason }, { status: 400 });

  const stored = [];
  for (const file of incoming) {
    stored.push(await storeSample(voice, file.name, Buffer.from(await file.arrayBuffer())));
  }

  return Response.json({ voice, stored, samples: await listSamples(voice) }, { status: 201 });
}
