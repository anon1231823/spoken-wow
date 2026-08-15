import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { currentSession, requireFeedback } from "@/lib/authz";
import { isKnownLine } from "@/lib/catalogue";
import { query } from "@/lib/db";
import { BODY_MAX, isCategory, type FeedbackReport } from "@/lib/feedback";
import { langFromParams, langOfBody } from "@/lib/lang";

// What a visitor said about a line, or about the project.
//
// POST IS THE ONLY UNAUTHENTICATED WRITE IN THIS APP. That is the whole point -- a guest
// who hears a mispronunciation has nowhere else to put it, and line_flag is deliberately
// editor-and-up because a flag is the regeneration worklist. It also means this route is
// the one place where the internet can reach the database, so the two things standing in
// the way of a flood are here and nowhere else: a honeypot field and a per-IP hourly cap.
//
// GET is the opposite: report BODIES are triager-only. Only the open COUNT is public, and
// it travels with the search results rather than through here.
//
// Both name a language (migration 0010): a report is about the text and narration the
// reporter had in front of them, and the count a triager sees is for the language they
// are triaging. Absent means English, so links and forms that predate the axis still
// file where they always did.

// Ten an hour is far more than a person filing real reports will ever hit -- the reports
// are prose about lines they have just listened to -- and low enough that a script gets
// bored. Deliberately not configurable: a knob nobody turns is a knob set wrong.
const PER_HOUR = 10;

type Body = {
  lineId?: unknown;
  category?: unknown;
  body?: unknown;
  name?: unknown;
  email?: unknown;
  /** The honeypot. A real form never sends this with anything in it. */
  website?: unknown;
  lang?: unknown;
};

/**
 * The client's address, as our own nginx reports it.
 *
 * X-REAL-IP, NOT X-FORWARDED-FOR, and the difference is the whole limiter.
 * deploy/nginx-lore.conf sets `X-Real-IP $remote_addr`, which proxy_set_header
 * OVERWRITES -- whatever the caller sent under that name is discarded, so the value that
 * arrives here is the address nginx accepted the connection from. It sets
 * `X-Forwarded-For $proxy_add_x_forwarded_for`, which APPENDS: a caller who sends
 * `X-Forwarded-For: 1.2.3.4` gets `1.2.3.4, <their real address>` through. Reading the
 * first entry of that -- the usual advice, and right behind a proxy that replaces the
 * header -- would let a script pick a new rate-limit bucket per request by making one up.
 *
 * So X-Forwarded-For is not consulted at all, not even as a fallback. With no proxy in
 * front -- `next dev`, or a misconfigured host -- every caller lands on "unknown" and
 * shares a single bucket of ten an hour. That is deliberately the strict failure: a
 * limiter that goes global is an annoyance, a limiter a header can walk around is not a
 * limiter. Any proxy put in front of this needs to set X-Real-IP, which is one line.
 */
function clientIp(requestHeaders: Headers): string {
  return requestHeaders.get("x-real-ip")?.trim() || "unknown";
}

/** A trimmed string, or null for anything absent, blank or not a string. */
function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return trimmed.slice(0, max);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;

  // The honeypot, checked first so a bot costs one comparison rather than a database
  // round trip. 200 and not 400: an error teaches the script to stop sending the field,
  // and then it is indistinguishable from a person.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);

  const [{ recent }] = await query<{ recent: number }>(
    `select count(*)::int as "recent"
       from "feedback"
      where "ip" = $1 and "createdAt" > now() - interval '1 hour'`,
    [ip],
  );

  // In Postgres rather than an in-memory map, so the limit survives a pm2 restart --
  // which is exactly the moment a flood would otherwise get through.
  if (recent >= PER_HOUR) {
    return NextResponse.json(
      { error: "That is a lot of feedback in one hour. Try again later." },
      { status: 429 },
    );
  }

  const lang = langOfBody(body.lang);
  if (!lang) {
    return NextResponse.json({ error: `unknown language ${String(body.lang)}` }, { status: 400 });
  }

  const lineId = body.lineId === undefined || body.lineId === null ? null : body.lineId;
  if (lineId !== null && typeof lineId !== "string") {
    return NextResponse.json({ error: "lineId must be a string or null" }, { status: 400 });
  }
  // Null is a real value here, unlike everywhere else: feedback about ZoneLore itself
  // belongs to no line. A non-null one is checked against the catalogue because the table
  // has no foreign key -- see the migration.
  if (lineId !== null && !(await isKnownLine(lineId))) {
    return NextResponse.json({ error: `unknown lineId ${lineId}` }, { status: 400 });
  }

  if (!isCategory(body.category)) {
    return NextResponse.json({ error: "category is not one we know" }, { status: 400 });
  }

  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (text === "") {
    return NextResponse.json({ error: "Say what is wrong with it." }, { status: 400 });
  }
  if (text.length > BODY_MAX) {
    return NextResponse.json(
      { error: `Keep it under ${BODY_MAX.toLocaleString()} characters.` },
      { status: 400 },
    );
  }

  // A signed-in reporter is identified by their account, and any name or email in the
  // body is ignored rather than merged: letting someone sign in and then type a different
  // name is a way to put words in another person's mouth.
  const session = await currentSession();
  const userId = session?.user.id ?? null;
  const name = userId ? null : optionalText(body.name, 200);
  const email = userId ? null : optionalText(body.email, 320);

  await query(
    `insert into "feedback" ("lineId", "lang", "category", "body", "userId", "name", "email", "ip")
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [lineId, lang, body.category, text, userId, name, email, ip],
  );

  // Deliberately not the row. The submitter cannot read feedback back, so an id would be
  // a handle on something they have no way to use.
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) {
  const { denied } = await requireFeedback();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const lineId = params.get("lineId");
  const lang = langFromParams(params);
  if (!lineId) {
    return NextResponse.json({ error: "lineId is required" }, { status: 400 });
  }

  const rows = await query<{
    id: number;
    lineId: string | null;
    category: FeedbackReport["category"];
    body: string;
    status: FeedbackReport["status"];
    createdAt: Date;
    resolvedAt: Date | null;
    reporterEmail: string | null;
    name: string | null;
    email: string | null;
    resolverEmail: string | null;
  }>(
    `select f."id", f."lineId", f."category", f."body", f."status",
            f."createdAt", f."resolvedAt", f."name", f."email",
            reporter."email" as "reporterEmail",
            resolver."email" as "resolverEmail"
       from "feedback" f
       left join "user" reporter on reporter."id" = f."userId"
       left join "user" resolver on resolver."id" = f."resolvedBy"
      where f."lineId" = $1 and f."lang" = $2
      order by f."createdAt" desc`,
    [lineId, lang],
  );

  // Open first regardless of age: the panel exists to answer "what is outstanding on this
  // line", and a resolved report from yesterday should not sit above an open one from last
  // week. Within each group the SQL ordering (newest first) survives, because sort is stable.
  const reports: FeedbackReport[] = rows
    .map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));

  return NextResponse.json({ reports });
}
