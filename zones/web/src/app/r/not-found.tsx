import Link from "next/link";

/**
 * A /r/ address that names no line.
 *
 * Worth its own page rather than the bare 404, because of how people get here: they
 * copied an address out of the game, and the two ways it can miss are a typo and lore
 * that has moved since their copy of the addon was built. Both deserve a way onwards --
 * and the general feedback link in the header covers the second one.
 */
export default function NotFound() {
  return (
    <main className="shell pt-8 pb-24">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold">No such entry</h1>
        <p className="mt-2 text-muted">
          That address does not name a line we know. Check it against the one the addon
          showed you — or find the entry yourself and report it from there.
        </p>
        <p className="mt-4">
          <Link href="/" className="text-accent hover:underline">
            Browse every line →
          </Link>
        </p>
      </div>
    </main>
  );
}
