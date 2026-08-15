import { NextResponse } from "next/server";

import { requireApiKey, requireConfigure } from "@/lib/authz";
import { langFromParams, langOfBody } from "@/lib/lang";
import { draftConfig, listVoices, loadManifest, measureRates, saveConfig } from "@/lib/tools";
import { parseSettings } from "@/lib/voice";

// One language's narrator voice and its settings, read and written.
//
// Admins only, like the lexicon: the voice is config for a whole language, not one
// line's problem. A change here alters every future generation in that language --
// but it does NOT mark anything stale (staleness is text-hash), so it only reaches
// the corpus through a regeneration pass, and the page says so.
//
// English is tools/voice/config.json; every other language is config.<code>.json
// merged over it, created by the first save here. Until then the language has no
// narrator, generation refuses it, and GET says so with `configured: false`.

export async function GET(request: Request) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  // Reading costs nothing, but the voice list IS the caller's account, so there is
  // nothing to render without their key.
  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const lang = langFromParams(new URL(request.url).searchParams);
  const [{ config, configured }, manifest] = await Promise.all([
    draftConfig(lang),
    loadManifest(lang),
  ]);
  // The whole account, unfiltered: voices added from the ElevenLabs library arrive
  // under their library names, so any name-based narrowing hides exactly the voices
  // the page exists to try.
  const voices = (await listVoices(key))
    .map((voice) => ({ id: voice.voice_id, name: voice.name, category: voice.category }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const { creditRate, measuredFrom } = measureRates(manifest, config);

  return NextResponse.json({
    lang,
    configured,
    voiceId: config.voiceId ?? null,
    voiceName: config.voiceName,
    modelId: config.modelId,
    languageCode: config.languageCode ?? null,
    voiceSettings: config.voiceSettings,
    voices,
    creditRate,
    measuredFrom,
  });
}

type Body = { voiceId?: unknown; voiceSettings?: unknown; lang?: unknown };

export async function POST(request: Request) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  const { key, denied: noKey } = await requireApiKey(session.user.id);
  if (noKey) return noKey;

  const body = (await request.json().catch(() => ({}))) as Body;

  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }
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
  //
  // The account is the saving admin's own, and the voice they pick is the language's.
  // Two admins with different ElevenLabs accounts can therefore pin a voice the other
  // cannot generate with -- which surfaces as a failed generation naming the voice,
  // not as silence, because resolveVoiceId checks the id it was given.
  const voices = await listVoices(key);
  const picked = voices.find((voice) => voice.voice_id === body.voiceId);
  if (!picked) {
    return NextResponse.json({ error: "voiceId is not on this account" }, { status: 400 });
  }

  // draftConfig, not loadConfig: the first save for a language is exactly the case
  // where loadConfig refuses, and this save is what turns it into a configured one.
  const { config } = await draftConfig(lang);
  config.voiceId = picked.voice_id;
  config.voiceName = picked.name;
  config.voiceSettings = settings;
  await saveConfig(config, lang);

  return NextResponse.json({
    lang,
    configured: true,
    voiceId: config.voiceId,
    voiceName: config.voiceName,
    voiceSettings: config.voiceSettings,
  });
}
