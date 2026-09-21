/**
 * A book page's live take: /api/books/audio/1381.mp3.
 *
 * The zones route's shape and guard: membership in the set of paths the corpus can
 * address, traversal-proof by construction. Which take plays is the row's `isCurrent`;
 * the bytes are that take's archived file.
 */
import { isAddressable } from "@/lib/books/audio";
import { BASE_LANG } from "@/lib/books/catalogue";
import { serveTake } from "@/lib/takes/serve";
import { livePath } from "@/lib/takes/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const rel = (await context.params).path.join("/");
  if (!(await isAddressable(rel, BASE_LANG))) return new Response("bad audio path", { status: 400 });
  return serveTake(request, await livePath("books", rel.slice(0, -".mp3".length), BASE_LANG), {
    immutable: false,
  });
}
