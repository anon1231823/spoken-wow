/**
 * Which file in the history directory holds a given take's bytes.
 *
 * Pure, and tested without a filesystem, because this is the one question in the take layer
 * whose wrong answer is silent: a restore that resolves to the wrong archived clip puts a
 * different line in the store, the addon plays it, and the person who finds out is a player.
 *
 * Two namings exist on disk and both stay readable forever, because archived audio is never
 * renamed or deleted:
 *
 *   quests        `{version}.mp3` -- the number IS the take version, since commitVersion
 *                 archives each take as it is cut. `0.mp3` is the take that predates the
 *                 app (INHERITED_VERSION).
 *   zones, books  `v{n}.mp3` -- n counts what was already in the directory when a clip was
 *                 displaced, so it is a position in a sequence of overwrites. The take
 *                 whose bytes it holds has to be worked out.
 *
 * Everything cut from now on is archived under its own version and records that name in
 * `take."archiveFile"`, so this reasoning applies only to what is already there.
 */

/** The name a take cut today is archived under, in every section. */
export function archiveNameFor(version: number): string {
  return `v${version}.mp3`;
}

/** The version a history filename names, or null when the name is not one of ours. */
export function versionInName(name: string): number | null {
  const match = /^v?(\d+)\.mp3$/.exec(name);
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

/** History filenames, ascending by the number in them. Anything else is dropped. */
export function sortedArchiveNames(names: readonly string[]): string[] {
  return names
    .filter((name) => versionInName(name) !== null)
    .sort((a, b) => versionInName(a)! - versionInName(b)!);
}

export type TakeRef = {
  version: number;
  /** What the row already claims, when it was cut under the current naming. */
  archiveFile?: string | null;
  isCurrent?: boolean;
};

/**
 * Take version -> the file holding its bytes, for one line.
 *
 * Three ways an answer is reached, and they are never mixed, because the two namings
 * disagree about what their number means and a coincidence between them is exactly the
 * silent wrong answer this module exists to avoid:
 *
 * 1. The take records its own `archiveFile`. Written when it was cut; nothing to work out.
 * 2. A bare `{n}.mp3` is the quests naming, where the number IS the take version because
 *    commitVersion archives each take as it is cut. Matched by number.
 * 3. A `v{n}.mp3` that no take claims is a zones or books clip from before this column
 *    existed, where n counts overwrites. Each archived clip is one that a later cut
 *    displaced, so the names in ascending order line up with the superseded takes in
 *    ascending order, oldest first -- and the live take is not among them, having
 *    displaced nothing yet.
 *
 * The third is used only when the counts line up exactly. A directory holding three clips
 * for five superseded takes has lost two somewhere, and any pairing over it is an offset
 * guess about which clip is which. Those takes come back unresolved, and the caller shows
 * them as unplayable -- what it already does for a take whose audio is gone.
 */
export function resolveArchive(
  takes: readonly TakeRef[],
  names: readonly string[],
): Map<number, string> {
  const found = new Map<number, string>();
  const present = new Set(sortedArchiveNames(names));

  // 1. What the rows already claim.
  for (const take of takes) {
    if (take.archiveFile && present.has(take.archiveFile)) {
      found.set(take.version, take.archiveFile);
    }
  }
  const claimed = new Set(found.values());

  // 2. The quests naming, which is version-true by construction. Only bare names: a
  //    `v{n}` nobody claimed carries a position, and reading it as a version is the
  //    mistake that plays another line.
  for (const take of takes) {
    if (found.has(take.version)) continue;
    const bare = `${take.version}.mp3`;
    if (present.has(bare) && !claimed.has(bare)) {
      found.set(take.version, bare);
      claimed.add(bare);
    }
  }

  // 3. Whatever is left is legacy zones or books numbering, paired by position.
  const unresolved = takes
    .filter((take) => !found.has(take.version) && !take.isCurrent)
    .sort((a, b) => a.version - b.version);
  const spare = sortedArchiveNames(names).filter((name) => !claimed.has(name));

  // Exactly, or not at all. An offset pairing is worse than no answer: it resolves, it
  // looks right, and it plays somebody else's line.
  if (unresolved.length > 0 && unresolved.length === spare.length) {
    unresolved.forEach((take, index) => found.set(take.version, spare[index]));
  }

  return found;
}
