import { NextResponse } from "next/server";

import { requireConfigure } from "@/lib/authz";
import {
  apiKey,
  listVoices,
  loadConfig,
  loadManifest,
  measureRates,
  saveConfig,
} from "@/lib/tools";
import { NARRATOR, parseSettings } from "@/lib/voice";

// The narrator voice and its settings, read and written.
//
// Admins only, like the lexicon: the voice is global config, not one line's problem.
// A change here alters every future generation -- but it does NOT mark anything stale
// (staleness is text-hash), so it only reaches the corpus through a regeneration
// pass, and the page says so.

export async function GET() {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const [config, manifest] = await Promise.all([loadConfig(), loadManifest()]);
  const voices = (await listVoices(await apiKey()))
    .filter((voice) => NARRATOR.test(voice.name))
    .map((voice) => ({ id: voice.voice_id, name: voice.name, category: voice.category }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { creditRate, measuredFrom } = measureRates(manifest, config);

  return NextResponse.json({
    voiceId: config.voiceId ?? null,
    voiceName: config.voiceName,
    modelId: config.modelId,
    voiceSettings: config.voiceSettings,
    voices,
    creditRate,
    measuredFrom,
  });
}

type Body = { voiceId?: unknown; voiceSettings?: unknown };

export async function POST(request: Request) {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Body;

  const settings = parseSettings(body.voiceSettings);
  if (settings === null) {
    return NextResponse.json({ error: "invalid voiceSettings" }, { status: 400 });
  }
  if (typeof body.voiceId !== "string") {
    return NextResponse.json({ error: "voiceId is required" }, { status: 400 });
  }

  // Validated against the live account list, which also supplies the current name:
  // config.json pins both, and a name that drifts from the id defeats the pin's
  // purpose of making the pairing auditable.
  const voices = await listVoices(await apiKey());
  const picked = voices.find((voice) => voice.voice_id === body.voiceId);
  if (!picked || !NARRATOR.test(picked.name)) {
    return NextResponse.json({ error: "voiceId is not a narrator voice" }, { status: 400 });
  }

  const config = await loadConfig();
  config.voiceId = picked.voice_id;
  config.voiceName = picked.name;
  config.voiceSettings = settings;
  await saveConfig(config);

  return NextResponse.json({
    voiceId: config.voiceId,
    voiceName: config.voiceName,
    voiceSettings: config.voiceSettings,
  });
}
