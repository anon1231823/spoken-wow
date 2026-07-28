/**
 * Turn a voice's clips into an ElevenLabs voice.
 *
 * This is the endpoint that spends something: a custom voice slot, capped by the plan (30
 * on Creator). Replacing is delete-then-add rather than an update, because ElevenLabs has no
 * "re-train this voice" call and two voices sharing a name would make fetch_voice_map
 * ambiguous — the Python side resolves by name, and would pick whichever came back first.
 */
import fs from "node:fs/promises";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";

import { denyVoiceRequest } from "@/lib/voices/authz";
import { recordClone } from "@/lib/voices/clones";
import { addVoice, deleteVoice, listVoices } from "@/lib/voices/elevenlabs";
import { listSamples, samplePath } from "@/lib/voices/samples";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ voice: string }> };

export async function POST(request: Request, context: Context) {
  const { voice } = await context.params;
  const denied = await denyVoiceRequest(voice);
  if (denied) return denied;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "not allowed" }, { status: 403 });

  const body = await request.json().catch(() => ({}) as Record<string, unknown>);
  const replace = body.replace === true;

  const samples = await listSamples(voice);
  if (samples.length === 0) {
    return Response.json({ error: "upload at least one clip first" }, { status: 400 });
  }

  // Read the account rather than the provenance table: a voice created in the ElevenLabs
  // dashboard is just as real to the generator, and refusing to notice it would let this
  // create a second voice with the same name.
  let existing: Map<string, string>;
  try {
    existing = await listVoices();
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }

  const current = existing.get(voice);
  if (current && !replace) {
    return Response.json(
      { error: `"${voice}" already exists; replacing it deletes the current voice` },
      { status: 409 },
    );
  }

  const clips = await Promise.all(
    samples.map(async (sample) => ({
      name: sample.file,
      data: await fs.readFile(samplePath(voice, sample.file)),
    })),
  );

  // Deleted first: ElevenLabs rejects a duplicate name, and a failure here must stop the
  // request rather than leave the old voice in place while reporting success.
  if (current) {
    try {
      await deleteVoice(current);
    } catch (error) {
      return Response.json({ error: `could not replace: ${message(error)}` }, { status: 502 });
    }
  }

  let voiceId: string;
  try {
    voiceId = await addVoice(voice, clips);
  } catch (error) {
    // The window that matters: the old voice is gone and the new one failed, so the slot is
    // empty. The clips are all still on disk, so retrying is the fix - say so.
    const lost = current ? " The previous voice was deleted; the clips are intact, so retry." : "";
    return Response.json({ error: message(error) + lost }, { status: 502 });
  }

  // The voice exists by this point, and this table is explicitly not what decides that -
  // listVoices is. So a provenance write that fails must not report the clone as failed,
  // which would leave the operator re-creating a voice they already have.
  let warning: string | undefined;
  try {
    await recordClone({
      voice,
      voiceId,
      clonedBy: session.user.id,
      sampleCount: samples.length,
      sampleBytes: samples.reduce((sum, sample) => sum + sample.bytes, 0),
    });
  } catch (error) {
    warning = `the voice was created but its provenance was not recorded: ${message(error)}`;
    console.error(`voice_clone insert failed for ${voice}:`, error);
  }

  return Response.json({ voice, voiceId, replaced: Boolean(current), warning }, { status: 201 });
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
