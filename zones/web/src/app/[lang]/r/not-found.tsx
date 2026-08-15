import { HomeLink } from "@/components/HomeLink";
import { NotFoundText } from "@/components/NotFoundText";

/**
 * A /r/ address that names no line.
 *
 * Worth its own page rather than the bare 404, because of how people get here: they
 * copied an address out of the game, and the two ways it can miss are a typo and lore
 * that has moved since their copy of the addon was built. Both deserve a way onwards --
 * and the general feedback link in the header covers the second one.
 */
export default function NotFound() {
  // A not-found file gets no params, so the language comes from the URL on the client.
  return (
    <main className="shell pt-8 pb-24">
      <div className="max-w-2xl">
        <NotFoundText />
        <p className="mt-4">
          <HomeLink className="text-accent hover:underline">
            <NotFoundText part="browse" />
          </HomeLink>
        </p>
      </div>
    </main>
  );
}
