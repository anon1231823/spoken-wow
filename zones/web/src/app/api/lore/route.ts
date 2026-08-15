import { NextResponse } from "next/server";

import { requireRegenerate } from "@/lib/authz";
import { invalidateCatalogue, isKnownLine } from "@/lib/catalogue";
import { langFromParams, langOfBody } from "@/lib/lang";
import { LoreConflict, LoreMissing, loreHistory, restoreLore, saveLore } from "@/lib/lore";

// The words themselves, read and rewritten.
//
// Guarded at the regenerate level -- editor and up -- rather than the lexicon's admin
// level. A pronunciation rule is global: it changes the spoken text of every line
// containing the word, and therefore what a regeneration pass costs next. A rewrite is
// one line, fully reversible through the version history, and belongs with the other
// per-line judgements an editor already makes.
//
// Editing does not regenerate. The new text hashes differently from the take that was
// spoken, so the line simply reads "text changed" and joins the regeneration worklist
// like any other stale line. Coupling a free action to a paid one is how a typo fix ends
// up costing credits.

export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const lineId = params.get("lineId");
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  const lang = langFromParams(params);
  return NextResponse.json({ lineId, lang, versions: await loreHistory(lineId, lang) });
}

export async function PUT(request: Request) {
  const { session, denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    full?: unknown;
    short?: unknown;
    name?: unknown;
    note?: unknown;
    expectedVersion?: unknown;
    lang?: unknown;
  };

  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }

  if (typeof body.lineId !== "string" || body.lineId === "") {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }
  if (typeof body.full !== "string" || body.full.trim() === "") {
    return NextResponse.json({ error: "full is required" }, { status: 400 });
  }
  if (body.short !== undefined && body.short !== null && typeof body.short !== "string") {
    return NextResponse.json({ error: "short must be a string or null" }, { status: 400 });
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== "string") {
    return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
  }
  if (body.name !== undefined && body.name !== null && typeof body.name !== "string") {
    return NextResponse.json({ error: "name must be a string or null" }, { status: 400 });
  }
  if (
    body.expectedVersion !== undefined &&
    body.expectedVersion !== null &&
    !Number.isInteger(body.expectedVersion)
  ) {
    return NextResponse.json({ error: "expectedVersion must be an integer" }, { status: 400 });
  }
  // Same reasoning as the flags route: nothing here has a foreign key onto the
  // catalogue, so this is what stops a typo becoming a row nothing will ever show.
  if (!(await isKnownLine(body.lineId))) {
    return NextResponse.json({ error: `unknown lineId ${body.lineId}` }, { status: 400 });
  }

  try {
    const version = await saveLore({
      lineId: body.lineId,
      full: body.full,
      short: (body.short as string | null | undefined) ?? null,
      name: (body.name as string | null | undefined) ?? null,
      note: (body.note as string | null | undefined) ?? null,
      editedBy: session.user.id,
      expectedVersion: (body.expectedVersion as number | null | undefined) ?? null,
      lang,
    });

    // The catalogue is memoised, and the edit has just changed what it should say.
    invalidateCatalogue(lang);
    return NextResponse.json({ lineId: body.lineId, lang, version });
  } catch (err) {
    if (err instanceof LoreConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof LoreMissing) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as {
    lineId?: unknown;
    version?: unknown;
    lang?: unknown;
  };

  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }
  if (typeof body.lineId !== "string" || body.lineId === "") {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }
  if (!Number.isInteger(body.version)) {
    return NextResponse.json({ error: "version must be an integer" }, { status: 400 });
  }

  try {
    const version = await restoreLore(body.lineId, body.version as number, lang);
    invalidateCatalogue(lang);
    return NextResponse.json({ lineId: body.lineId, lang, version });
  } catch (err) {
    if (err instanceof LoreMissing) {
      return NextResponse.json({ error: (err as Error).message }, { status: 404 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
