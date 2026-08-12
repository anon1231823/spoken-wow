import { NextResponse } from "next/server";

import { requireApiKey, requireRegenerate } from "@/lib/authz";
import {
  loadConfig,
  loadPronunciation,
  resolveDictionary,
  synthesize,
  toSpokenText,
} from "@/lib/tools";
import { parseSettings } from "@/lib/voice";

// One audition, straight to the ear. Spends credits like /api/regenerate -- same
// guard -- but deliberately leaves no trace: no take row, no archive, no publish.
// A preview is a question about a voice, not a change to the corpus, and recording
// it would put clips in the store that no line owns.
//
// The text goes through the same pronunciation rules and the same pinned dictionary
// as a real generation, so what is auditioned is what a regeneration would produce.

// Enough to judge a narrator, small enough that a stray paste of a whole zone's
// prose cannot cost real money.
const MAX_CHARS = 1000;

type Body = { text?: unknown; voiceId?: unknown; voiceSettings?: unknown };

export async function POST(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const body = (await request.json().catch(() => ({}))) as Body;

  if (typeof body.text !== "string" || body.text.trim() === "") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  if (typeof body.voiceId !== "string") {
    return NextResponse.json({ error: "voiceId is required" }, { status: 400 });
  }
  const settings = parseSettings(body.voiceSettings);
  if (settings === null) {
    return NextResponse.json({ error: "invalid voiceSettings" }, { status: 400 });
  }

  const rules = await loadPronunciation();
  const spoken = toSpokenText(body.text, rules);
  if (spoken.length > MAX_CHARS) {
    return NextResponse.json(
      { error: `preview text is capped at ${MAX_CHARS} characters` },
      { status: 400 },
    );
  }

  const config = { ...(await loadConfig()), voiceId: body.voiceId, voiceSettings: settings };
  // In-memory only: the dictionary's latest version, same as a real generation uses.
  await resolveDictionary(config, key);

  try {
    const { audio, credits } = await synthesize(spoken, config, key);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        ...(credits !== null ? { "X-Credits": String(credits) } : {}),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
