import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackTable, type FeedbackRow } from "@/components/FeedbackTable";
import { currentSession } from "@/lib/authz";
import { catalogue } from "@/lib/catalogue";
import { query } from "@/lib/db";
import type { Category, Status } from "@/lib/feedback";
import { BASE_LANG, isLang } from "@/lib/lang";
import { canTriageFeedback } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Feedback" };

/**
 * Everything visitors have reported, newest first.
 *
 * The counterpart of the explorer's `flag=bad`: that is what an editor decided after
 * listening, this is what somebody else said without being asked. Both end in the same
 * place -- a regeneration, a lexicon rule, or a shrug -- but they arrive from opposite
 * directions and mixing them would lose which is which.
 */

const VIEWS = ["open", "resolved", "all"] as const;
type View = (typeof VIEWS)[number];

// Open first, because the page exists to empty that list. Validated against the tuple
// rather than trusted, for the reason filters.ts gives: a hand-edited URL should fall
// back to a real view rather than select nothing and read as missing data.
function viewOf(value: string | string[] | undefined): View {
  return typeof value === "string" && (VIEWS as readonly string[]).includes(value)
    ? (value as View)
    : "open";
}

// Every view is one language's reports (migration 0010): the page under /deDE is
// the German triage list, and a report about German narration must not surface in
// the English one, where nobody can act on it.
const WHERE: Record<View, string> = {
  open: `where f."lang" = $1 and f."status" = 'open'`,
  resolved: `where f."lang" = $1 and f."status" <> 'open'`,
  all: `where f."lang" = $1`,
};

type Row = {
  id: number;
  lineId: string | null;
  category: Category;
  body: string;
  status: Status;
  createdAt: Date;
  resolvedAt: Date | null;
  name: string | null;
  email: string | null;
  reporterEmail: string | null;
  resolverEmail: string | null;
};

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { lang: rawLang } = await params;
  // The layout already 404s an unknown code; the guard here is what types the value.
  const lang = isLang(rawLang) ? rawLang : BASE_LANG;
  const session = await currentSession();

  // 404 rather than a redirect to /login, matching /admin and /lexicon: a member has no
  // business learning this page exists.
  if (!session || !canTriageFeedback(session.user.role)) notFound();

  const view = viewOf((await searchParams).status);

  const [rows, entries] = await Promise.all([
    query<Row>(
      `select f."id", f."lineId", f."category", f."body", f."status",
              f."createdAt", f."resolvedAt", f."name", f."email",
              reporter."email" as "reporterEmail",
              resolver."email" as "resolverEmail"
         from "feedback" f
         left join "user" reporter on reporter."id" = f."userId"
         left join "user" resolver on resolver."id" = f."resolvedBy"
         ${WHERE[view]}
        order by f."createdAt" desc
        limit 500`,
      [lang],
    ),
    catalogue(lang),
  ]);

  // lineId -> where it is, so a report can link into the explorer. Built from the
  // catalogue because a line is not a row and the feedback table stores only the id.
  const lines = new Map(entries.map((entry) => [entry.id, entry]));

  const feedback: FeedbackRow[] = rows.map((row) => {
    const entry = row.lineId ? lines.get(row.lineId) : undefined;
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      // A lineId with no catalogue entry means the lore data moved under a report that
      // was valid when it was filed. Showing the raw id beats showing nothing: it is
      // still the only handle on what the person was talking about.
      lineName: entry ? (entry.name || entry.zoneName) : row.lineId,
      zoneName: entry?.zoneName ?? null,
      mapID: entry?.mapID ?? null,
    };
  });

  return (
    <main className="shell pt-8 pb-24">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <p className="mt-1 mb-5 text-muted">
        What visitors reported, newest first. Anyone can file one, signed in or not, so
        treat these as claims rather than verdicts — closing one as{" "}
        <strong className="text-fg">not an issue</strong> is a normal outcome. Reopening a
        closed report is always possible.
      </p>

      {/* Links rather than a control, so the view is shareable and the back button
          works -- the same argument filters.ts makes for the explorer. */}
      <nav className="mb-4 flex items-center gap-2 text-muted">
        {VIEWS.map((value) => (
          <Link
            key={value}
            href={value === "open" ? `/${lang}/feedback` : `/${lang}/feedback?status=${value}`}
            className={cn(
              "rounded border px-2 py-0.5",
              value === view
                ? "border-border bg-panel text-fg"
                : "border-transparent hover:border-border hover:text-fg",
            )}
          >
            {value}
          </Link>
        ))}
      </nav>

      <FeedbackTable rows={feedback} />
    </main>
  );
}
