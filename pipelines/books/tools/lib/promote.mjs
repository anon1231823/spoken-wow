// What a re-import does to a line that already exists.
//
// The rule lore_line's recordScrape follows, for the same reason: an import that could
// overwrite a correction is an import nobody dares run, and an import nobody runs means
// the corpus quietly stops tracking the dump. Recording without promoting keeps upstream
// movement visible in the history, where somebody can promote it deliberately.

/**
 * @param current the live row, or null if the line is new
 * @param incoming the extracted entry
 */
export function decideImport(current, incoming) {
  if (!current) return { action: "promote" };
  if (current.text === incoming.text) return { action: "skip" };
  return { action: current.origin === "edited" ? "record" : "promote" };
}

/**
 * The structural fields the extract has moved, whatever the text says.
 *
 * Text and structure are versioned differently on purpose. Text is content: a new version
 * is recorded so the history shows it, and an edit outranks the dump. Structure is a fact
 * about the world -- which book a page belongs to, what number it is, what the object is
 * called -- and 0026 says plainly that it is the extract's business and not an editor's.
 * So structure is corrected in place on the live row, on edited lines too.
 *
 * Without this, a page could only be re-placed by changing its text as well. One page moved
 * between books the first time this ran, when a deprecated test item stopped claiming page
 * 265 of the Hillsbrad Town Registry, and its text never changed at all.
 */
const STRUCTURAL = ["bookId", "pageNumber", "pageCount", "title", "ownerKind", "material", "generatable", "skipReason"];

export function structuralDiff(current, incoming) {
  const diff = {};
  for (const field of STRUCTURAL) {
    if (current[field] !== incoming[field]) diff[field] = incoming[field];
  }
  // An array, so compared by value rather than by reference like the rest.
  const ids = current.ownerIds ?? [];
  const next = incoming.ownerIds ?? [];
  if (ids.length !== next.length || ids.some((id, index) => id !== next[index])) {
    diff.ownerIds = next;
  }
  return diff;
}
