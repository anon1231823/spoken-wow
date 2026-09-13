/**
 * Hearing one lexicon entry.
 *
 * `admin`, matching the rest of the lexicon routes, and this one has a second reason: it
 * spends credits on every miss. A route anyone could hold down would be a route anyone could
 * empty the month's budget with.
 *
 * POST rather than GET even though it reads. The entry is a draft that has not been saved
 * anywhere, so there is nothing to name in a URL - and a miss is not a safe request, since
 * it costs money.
 *
 * The body is one entry plus a mode, and the entry is validated the way a saved one is. A
 * preview of an entry the lexicon would refuse to store is a preview of something that can
 * never ship.
 */
import { requireApiKey, requireConfigure } from "@/lib/generation/authz";
import { LexiconError, validateEntry } from "@/lib/generation/lexicon";
import { isPreviewMode, renderPreview, voicePicker } from "@/lib/generation/preview";
import { currentConfig } from "@/lib/generation/settings";
import { generationStatus } from "@/lib/generation/status";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  let entry;
  let mode;
  let force = false;
  try {
    const body = (await request.json()) as { entry?: unknown; mode?: unknown; force?: unknown };
    entry = validateEntry(body.entry, 0);
    if (!isPreviewMode(body.mode)) throw new LexiconError("mode must be word or sentence");
    mode = body.mode;
    force = body.force === true;
  } catch (error) {
    const message = error instanceof LexiconError ? error.message : "invalid entry";
    return Response.json({ error: message }, { status: 400 });
  }

  const [config, status] = await Promise.all([
    currentConfig(),
    generationStatus({ apiKey: key }),
  ]);
  if (status.error && status.voiceIds.size === 0) {
    return Response.json({ error: status.error }, { status: 502 });
  }

  const result = await renderPreview(
    entry,
    mode,
    voicePicker(status.voiceIds),
    config,
    { apiKey: key },
    undefined,
    force,
  );
  if (!result.ok) {
    return Response.json(
      { error: result.failure.message },
      { status: result.failure.status ?? 502 },
    );
  }

  const { audio, ...meta } = result.preview;

  // The audio comes back as the body and everything about it as headers, so the browser can
  // hand the response straight to an <audio> element without a base64 round trip through
  // JSON - a preview is small, but decoding one to play it is work for nothing.
  return new Response(new Uint8Array(audio), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(audio.byteLength),
      // Not cached by the browser: the server cache is the one that matters, it is keyed on
      // the entry rather than the URL, and a stale browser copy would play the previous
      // pronunciation after an edit.
      "Cache-Control": "no-store",
      "X-Preview": encodeURIComponent(JSON.stringify(meta)),
    },
  });
}
