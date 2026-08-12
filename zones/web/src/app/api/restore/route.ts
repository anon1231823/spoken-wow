import { NextResponse } from "next/server";

import { archivedVersions } from "@/lib/audio";
import { requireRegenerate } from "@/lib/authz";
import { catalogue } from "@/lib/catalogue";
import { isLang, langFromParams, BASE_LANG, type Lang } from "@/lib/lang";
import { restore } from "@/lib/regenerate";

// Which superseded takes a line has, and putting one back. Free -- no API call.
//
// Guarded at the same level as regeneration rather than a lower one: restoring costs
// nothing, but it changes what the addon ships and what everyone else hears, and the pair
// only makes sense held by the same person.

export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const lineId = params.get("lineId");
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  const lang = langFromParams(params);
  const entries = await catalogue(lang);
  const entry = entries.find((candidate) => candidate.id === lineId);
  if (!entry) return NextResponse.json({ error: `unknown lineId ${lineId}` }, { status: 400 });

  return NextResponse.json({ lineId, lang, versions: await archivedVersions(entry.file, lang) });
}

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    version?: unknown;
    lang?: unknown;
  };

  const lang: Lang | null =
    body.lang === undefined || body.lang === null
      ? BASE_LANG
      : isLang(body.lang)
        ? body.lang
        : null;
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }
  if (typeof body.lineId !== "string") {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }
  if (typeof body.version !== "number" || !Number.isInteger(body.version)) {
    return NextResponse.json({ error: "version must be an integer" }, { status: 400 });
  }

  try {
    return NextResponse.json(await restore(body.lineId, body.version, lang));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
