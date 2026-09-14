/**
 * The review queue's rows.
 *
 * `collaborator` rather than `admin`, matching the lexicon's GET and for the same reason:
 * someone about to spend characters is entitled to know what is wrong with the line they are
 * about to voice. Recording a verdict is the admin half, and lives in [id]/route.ts.
 */
import { requireRegenerate } from "@/lib/generation/authz";
import { VERDICTS, type Verdict } from "@/lib/issues/issues";
import { issueList } from "@/lib/issues/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { denied } = await requireRegenerate();
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const verdict = params.get("verdict");
  const severity = Number(params.get("severity"));

  // Unknown values are dropped rather than rejected, as filtersFromParams does it: these come
  // from dropdowns over closed sets, so anything else is a stale link, and a wider list is a
  // better answer than a 400.
  const issues = await issueList({
    category: params.get("category") ?? undefined,
    group: params.get("group") ?? undefined,
    severity: severity >= 1 && severity <= 3 ? severity : undefined,
    verdict: (VERDICTS as readonly string[]).includes(verdict ?? "")
      ? (verdict as Verdict)
      : undefined,
    q: params.get("q") ?? undefined,
    includeUndetected: params.get("undetected") === "1",
  });

  return Response.json({ issues });
}
