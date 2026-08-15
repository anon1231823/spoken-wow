import { NextResponse } from "next/server";

import { requireApiKey, requireConfigure } from "@/lib/authz";
import { langFromParams, langOfBody } from "@/lib/lang";
import { draftConfig, resolveDictionary, saveConfig } from "@/lib/tools";

// One language's ElevenLabs pronunciation dictionary, read and written.
//
// Admins only, like the voice: the dictionary applies to every line generated in the
// language, and it is never inherited from English (see draftConfig) -- an English
// phoneme dictionary applied to German rewrites words that happen to be spelled the
// same. It lives in the language's config file beside the voice; this route is the
// dictionary half of what /api/voice does for the narrator, kept apart because it
// may be set before a narrator is picked and must not require one.
//
// Only the id is stored. The version is resolved at the start of every run, so the
// newest rules always apply and each take records which version it was made with.

export async function GET(request: Request) {
  const { denied } = await requireConfigure();
  if (denied) return denied;

  const lang = langFromParams(new URL(request.url).searchParams);
  const { config } = await draftConfig(lang);
  return NextResponse.json({ lang, dictionaryId: config.dictionaryId ?? null });
}

type Body = { dictionaryId?: unknown; lang?: unknown };

export async function POST(request: Request) {
  const { session, denied } = await requireConfigure();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Body;

  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }
  const dictionaryId =
    body.dictionaryId === undefined || body.dictionaryId === null
      ? null
      : typeof body.dictionaryId === "string"
        ? body.dictionaryId.trim() || null
        : undefined;
  if (dictionaryId === undefined) {
    return NextResponse.json({ error: "dictionaryId must be a string or null" }, { status: 400 });
  }

  // Checked against the saving admin's account the way the voice is: a mistyped id
  // would otherwise fail every generation in this language at the first line, after
  // the batch had been quoted and confirmed. Clearing needs no key.
  if (dictionaryId !== null) {
    const { key, denied: noKey } = await requireApiKey(session.user.id);
    if (noKey) return noKey;
    try {
      await resolveDictionary({ dictionaryId, dictionaryVersionId: null }, key);
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  const { config } = await draftConfig(lang);
  config.dictionaryId = dictionaryId;
  // A pinned version belongs to the dictionary it was resolved from.
  if (config.dictionaryVersionId) config.dictionaryVersionId = undefined;
  await saveConfig(config, lang);

  return NextResponse.json({ lang, dictionaryId });
}
